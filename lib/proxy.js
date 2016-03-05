'use strict';

var async = require('async');
var net = require('net');
var http = require('http');
var https = require('https');
var util = require('util');
var fs = require('fs');
var path = require('path');
var events = require('events');
var mkdirps = require('mkdirps');
var WebSocket = require('ws');
var url = require('url');
var os = require('os');
var semaphore = require('semaphore');
var ca = require('./ca.js');

module.exports = function() {
  return new Proxy();
};



module.exports.gunzip = require('./middleware/gunzip');
module.exports.wildcard = require('./middleware/wildcard');

var Proxy = function() {
  this.onRequestHandlers = [];
  this.onRequestHeadersHandlers = [];
  this.onWebSocketConnectionHandlers = [];
  this.onWebSocketFrameHandlers = [];
  this.onWebSocketCloseHandlers = [];
  this.onWebSocketErrorHandlers = [];
  this.onErrorHandlers = [];
  this.onRequestDataHandlers = [];
  this.onRequestEndHandlers = [];
  this.onResponseHandlers = [];
  this.onResponseHeadersHandlers = [];
  this.onResponseDataHandlers = [];
  this.onResponseEndHandlers = [];
};

module.exports.Proxy = Proxy;

Proxy.prototype.listen = function(options, callback) {
  var self = this;
  this.options = options || {};
  this.silent = !!options.silent;
  this.httpPort = options.port || 8080;
  this.timeout = options.timeout || 0;
  this.httpAgent = options.httpAgent || new http.Agent();
  this.httpsAgent = options.httpsAgent || new https.Agent();
  this.forceSNI = !!options.forceSNI;
  if (this.forceSNI && !this.silent) {
    console.log('SNI enabled. Clients not supporting SNI may fail');
  }
  this.useNamedSocket = !!options.useNamedSocket;
  this.httpsPort = this.forceSNI ? options.httpsPort : undefined;
  this.sslCaDir = options.sslCaDir || path.resolve(process.cwd(), '.http-mitm-proxy');
  this.ca = new ca(this.sslCaDir);
  this.sslServers = {};
  this.sslSemaphores = {};
  mkdirps(this.sslCaDir, function(err) {
    if (err) {
      self._onError('CERT_DIRECTORY_CREATION', null, err);
    }
    self.httpServer = http.createServer();
    self.httpServer.timeout = self.timeout;
    self.httpServer.on('error', self._onError.bind(self, 'HTTP_SERVER_ERROR', null));
    self.httpServer.on('connect', self._onHttpServerConnect.bind(self));
    self.httpServer.on('request', self._onHttpServerRequest.bind(self, false));
    self.wsServer = new WebSocket.Server({ server: self.httpServer });
    self.wsServer.on('connection', self._onWebSocketServerConnect.bind(self, false));
    if (self.forceSNI) {
      // start the single HTTPS server now
      self._createHttpsServer({}, function(portOrSocket, httpsServer, wssServer) {
        if (!self.silent) {
          console.log('https server started on '+portOrSocket);
        }
        self.httpsServer = httpsServer;
        self.wssServer = wssServer;
        self.httpsPort = portOrSocket;
        self.httpServer.listen(self.httpPort, callback);
      });
    } else {
      self.httpServer.listen(self.httpPort, callback);
    }
  });
  return this;
};


Proxy.prototype._createHttpsServer = function (options, callback) {
  var httpsServer = https.createServer(options);
  httpsServer.timeout = this.timeout;
  httpsServer.on('error', this._onError.bind(this, 'HTTPS_SERVER_ERROR', null));
  httpsServer.on('clientError', this._onError.bind(this, 'HTTPS_CLIENT_ERROR', null));
  httpsServer.on('connect', this._onHttpServerConnect.bind(this));
  httpsServer.on('request', this._onHttpServerRequest.bind(this, true));
  var wssServer = new WebSocket.Server({ server: httpsServer });
  wssServer.on('connection', this._onWebSocketServerConnect.bind(this, true));
  var portOrSocket = this.httpsPort || (this.useNamedSocket ? Proxy.newNamedSocket() : undefined);
  httpsServer.listen(portOrSocket, function() {
    if (callback) callback(portOrSocket || httpsServer.address().port, httpsServer, wssServer);
  });
};

Proxy.prototype.close = function () {
  var self = this;
  this.httpServer.close();
  delete this.httpServer;
  if (self.forceSNI) {
    this.httpsServer.close();
    delete this.httpsServer;
    delete this.wssServer;
    delete this.sslServers;
  } else {
    (Object.keys(this.sslServers)).forEach(function (srvName) {
      var server = self.sslServers[srvName].server;
      if (server) server.close();
      delete self.sslServers[srvName];
    });
  }
  return this;
};

Proxy.prototype.onError = function(fn) {
  this.onErrorHandlers.push(fn);
  return this;
};

Proxy.prototype.onRequestHeaders = function(fn) {
  this.onRequestHeadersHandlers.push(fn);
  return this;
};

Proxy.prototype.onRequest = function(fn) {
  this.onRequestHandlers.push(fn);
  return this;
};

Proxy.prototype.onWebSocketConnection = function(fn) {
  this.onWebSocketConnectionHandlers.push(fn);
  return this;
};

Proxy.prototype.onWebSocketSend = function(fn) {
  this.onWebSocketFrameHandlers.push(function(ctx, type, fromServer, data, flags, callback) {
    if (!fromServer && type === 'message') return this(data, flags, callback);
    else callback(null, data, flags);
  }.bind(fn));
  return this;
};

Proxy.prototype.onWebSocketMessage = function(fn) {
  this.onWebSocketFrameHandlers.push(function(ctx, type, fromServer, data, flags, callback) {
    if (fromServer && type === 'message') return this(data, flags, callback);
    else callback(null, data, flags);
  }.bind(fn));
  return this;
};

Proxy.prototype.onWebSocketFrame = function(fn) {
  this.onWebSocketFrameHandlers.push(fn);
  return this;
};

Proxy.prototype.onWebSocketClose = function(fn) {
  this.onWebSocketCloseHandlers.push(fn);
  return this;
};

Proxy.prototype.onWebSocketError = function(fn) {
  this.onWebSocketErrorHandlers.push(fn);
  return this;
};

Proxy.prototype.onRequestData = function(fn) {
  this.onRequestDataHandlers.push(fn);
  return this;
};

Proxy.prototype.onRequestEnd = function(fn) {
  this.onRequestEndHandlers.push(fn);
  return this;
};

Proxy.prototype.onResponse = function(fn) {
  this.onResponseHandlers.push(fn);
  return this;
};

Proxy.prototype.onResponseHeaders = function(fn) {
  this.onResponseHeadersHandlers.push(fn);
  return this;
};

Proxy.prototype.onResponseData = function(fn) {
  this.onResponseDataHandlers.push(fn);
  return this;
};

Proxy.prototype.onResponseEnd = function(fn) {
  this.onResponseEndHandlers.push(fn);
  return this;
};

Proxy.prototype.use = function(mod) {
  if (mod.onError) {
    this.onError(mod.onError);
  }
  if (mod.onCertificateRequired) {
      this.onCertificateRequired = mod.onCertificateRequired;
  }
  if (mod.onCertificateMissing) {
      this.onCertificateMissing = mod.onCertificateMissing;
  }
  if (mod.onRequest) {
    this.onRequest(mod.onRequest);
  }
  if (mod.onRequestHeaders) {
    this.onRequestHeaders(mod.onRequestHeaders);
  }
  if (mod.onRequestData) {
    this.onRequestData(mod.onRequestData);
  }
  if (mod.onResponse) {
    this.onResponse(mod.onResponse);
  }
  if (mod.onResponseHeaders) {
    this.onResponseHeaders(mod.onResponseHeaders);
  }
  if (mod.onResponseData) {
    this.onResponseData(mod.onResponseData);
  }
  if (mod.onWebSocketConnection) {
    this.onWebSocketConnection(mod.onWebSocketConnection);
  }
  if (mod.onWebSocketSend) {
    this.onWebSocketFrame(function(ctx, type, fromServer, data, flags, callback) {
      if (!fromServer && type === 'message') return this(data, flags, callback);
      else callback(null, data, flags);
    }.bind(mod.onWebSocketSend));
  }
  if (mod.onWebSocketMessage) {
    this.onWebSocketFrame(function(ctx, type, fromServer, data, flags, callback) {
      if (fromServer && type === 'message') return this(data, flags, callback);
      else callback(null, data, flags);
    }.bind(mod.onWebSocketMessage));
  }
  if (mod.onWebSocketFrame) {
    this.onWebSocketFrame(mod.onWebSocketFrame);
  }
  if (mod.onWebSocketClose) {
    this.onWebSocketClose(mod.onWebSocketClose);
  }
  if (mod.onWebSocketError) {
    this.onWebSocketError(mod.onWebSocketError);
  }
  return this;
};

Proxy.prototype._onHttpServerConnect = function(req, socket, head) {
  var self = this;
  
  // we need first byte of data to detect if request is SSL encrypted
  if (!head || head.length === 0) {
    socket.once('data', function(data) {
      self._onHttpServerConnect(req, socket, data);
    });
    // respond to the client that the connection was made so it can send us data
    return socket.write('HTTP/1.1 200 OK\r\n\r\n');
  }

  socket.pause();

  /*
  * Detect TLS from first bytes of data
  * Inspered from https://gist.github.com/tg-x/835636
  * used heuristic:
  * - an incoming connection using SSLv3/TLSv1 records should start with 0x16
  * - an incoming connection using SSLv2 records should start with the record size
  *   and as the first record should not be very big we can expect 0x80 or 0x00 (the MSB is a flag)
  * - everything else is considered to be unencrypted
  */
  if (head[0] == 0x16 || head[0] == 0x80 || head[0] == 0x00) {
    // URL is in the form 'hostname:port'
    var hostname = req.url.split(':', 2)[0];
    var sslServer = this.sslServers[hostname];
    if (sslServer) {
      return makeConnection(sslServer.port);
    }
    var wilcardHost = hostname.replace(/[^\.]+\./, '*.');
    var sem = self.sslSemaphores[wilcardHost];
    if (!sem) {
      sem = self.sslSemaphores[wilcardHost] = semaphore(1);
    }
    sem.take(function() {
      if (self.sslServers[hostname]) {
        process.nextTick(sem.leave.bind(sem));
        return makeConnection(self.sslServers[hostname].port);
      }
      if (self.sslServers[wilcardHost]) {
        process.nextTick(sem.leave.bind(sem));
        self.sslServers[hostname] = {
          port: self.sslServers[wilcardHost]
        };
        return makeConnection(self.sslServers[hostname].port);
      }
      getHttpsServer(hostname, function(err, port) {
        process.nextTick(sem.leave.bind(sem));
        if (err) {
          return self._onError('OPEN_HTTPS_SERVER_ERROR', null, err);
        }
        return makeConnection(port);
      });
    });
  } else {
    return makeConnection(this.httpPort);
  }

  function makeConnection(portOrSocket) {
    // open a TCP connection to the remote host
    var conn = net.connect(portOrSocket, function() {
      // create a tunnel between the two hosts
      socket.pipe(conn);
      conn.pipe(socket);
      socket.emit('data', head);
      return socket.resume();
    });
    conn.on('error', self._onError.bind(self, 'PROXY_TO_PROXY_SOCKET_ERROR', null));
  }

  function getHttpsServer(hostname, callback) {
    self.onCertificateRequired(hostname, function (err, files) {
      async.auto({
        'keyFileExists': function(callback) {
          return fs.exists(files.keyFile, function(exists) {
            return callback(null, exists);
          });
        },
        'certFileExists': function(callback) {
          return fs.exists(files.certFile, function(exists) {
            return callback(null, exists);
          });
        },
        'httpsOptions': ['keyFileExists', 'certFileExists', function(callback, data) {
          if (data.keyFileExists && data.certFileExists) {
            return fs.readFile(files.keyFile, function(err, keyFileData) {
              if (err) {
                return callback(err);
              }

              return fs.readFile(files.certFile, function(err, certFileData) {
                if (err) {
                  return callback(err);
                }

                return callback(null, {
                  key: keyFileData,
                  cert: certFileData,
                  hosts: files.hosts
                });
              });
            });
          } else {
            var ctx = {
              'hostname': hostname,
              'files': files,
              'data': data
            };

            return self.onCertificateMissing(ctx, files, function(err, files) {
              if (err) {
                return callback(err);
              }

              return callback(null, {
                key: files.keyFileData,
                cert: files.certFileData,
                hosts: files.hosts
              });
            });
          }
        }]
      }, function(err, results) {
        if (err) {
          return callback(err);
        }
        var hosts;
        if (results.httpsOptions && results.httpsOptions.hosts && results.httpsOptions.hosts.length) {
          hosts = results.httpsOptions.hosts;
          if (hosts.indexOf(hostname) === -1) {
            hosts.push(hostname);
          }
        } else {
          hosts = [hostname];
        }
        delete results.httpsOptions.hosts;
        if (self.forceSNI) {
          if (!self.silent) {
            console.log('creating SNI context for ' + hostname);
          }
          hosts.forEach(function(host) {
            self.httpsServer.addContext(host, results.httpsOptions);
            self.sslServers[host] = { port : self.httpsPort };
          });
          return callback(null, self.httpsPort);
        } else {
          if (!self.silent) {
            console.log('starting server for ' + hostname);
          }
          self._createHttpsServer(results.httpsOptions, function(portOrSocket, httpsServer, wssServer) {
            if (!self.silent) {
              console.log('https server started for %s on %s', hostname, portOrSocket);
            }
            var sslServer = {
              server: httpsServer,
              wsServer: wssServer,
              port: portOrSocket
            };
            hosts.forEach(function(host) {
              self.sslServers[hostname] = sslServer;
            });
            return callback(null, portOrSocket);
          });
        }
      });
    });
  }

};


Proxy.prototype.onCertificateRequired = function (hostname, callback) {
  var self = this;
  return callback(null, {
    keyFile: self.sslCaDir + '/keys/' + hostname + '.key',
    certFile: self.sslCaDir + '/certs/' + hostname + '.pem',
    hosts: [hostname]
  });
  return this;
};
Proxy.prototype.onCertificateMissing = function (ctx, files, callback) {
  var hosts = files.hosts || [ctx.hostname];
  this.ca.generateServerCertificateKeys(hosts, function (certPEM, privateKeyPEM) {
    callback(null, {
      certFileData: certPEM,
      keyFileData: privateKeyPEM,
      hosts: hosts
    });
  });
  return this;
};

Proxy.prototype._onError = function(kind, ctx, err) {
  this.onErrorHandlers.forEach(function(handler) {
    return handler(ctx, err, kind);
  });
  if (ctx) {
    ctx.onErrorHandlers.forEach(function(handler) {
      return handler(ctx, err, kind);
    });
    
    if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
      ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
    }
    if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
      ctx.proxyToClientResponse.end(''+kind+': '+err, 'utf8');
    }
  }
};

Proxy.prototype._onWebSocketServerConnect = function(isSSL, ws) {
  var self = this;
  var ctx = {
    isSSL: isSSL,
    clientToProxyWebSocket: ws,
    onWebSocketConnectionHandlers: [],
    onWebSocketFrameHandlers: [],
    onWebSocketCloseHandlers: [],
    onWebSocketErrorHandlers: [],
    onWebSocketConnection: function(fn) {
      ctx.onWebSocketConnectionHandlers.push(fn);
      return ctx;
    },
    onWebSocketSend: function(fn) {
      ctx.onWebSocketFrameHandlers.push(function(ctx, type, fromServer, data, flags, callback) {
        if (!fromServer && type === 'message') return this(data, flags, callback);
        else callback(null, data, flags);
      }.bind(fn));
      return ctx;
    },
    onWebSocketMessage: function(fn) {
      ctx.onWebSocketFrameHandlers.push(function(ctx, type, fromServer, data, flags, callback) {
        if (fromServer && type === 'message') return this(data, flags, callback);
        else callback(null, data, flags);
      }.bind(fn));
      return ctx;
    },
    onWebSocketFrame: function(fn) {
      ctx.onWebSocketFrameHandlers.push(fn);
      return ctx;
    },
    onWebSocketClose: function(fn) {
      ctx.onWebSocketCloseHandlers.push(fn);
      return ctx;
    },
    onWebSocketError: function(fn) {
      ctx.onWebSocketErrorHandlers.push(fn);
      return ctx;
    },
    use: function(mod) {
      if (mod.onWebSocketConnection) {
        ctx.onWebSocketConnection(mod.onWebSocketConnection);
      }
      if (mod.onWebSocketSend) {
        ctx.onWebSocketFrame(function(ctx, type, fromServer, data, flags, callback) {
          if (!fromServer && type === 'message') return this(data, flags, callback);
          else callback(null, data, flags);
        }.bind(mod.onWebSocketSend));
      }
      if (mod.onWebSocketMessage) {
        ctx.onWebSocketFrame(function(ctx, type, fromServer, data, flags, callback) {
          if (fromServer && type === 'message') return this(data, flags, callback);
          else callback(null, data, flags);
        }.bind(mod.onWebSocketMessage));
      }
      if (mod.onWebSocketFrame) {
        ctx.onWebSocketFrame(mod.onWebSocketFrame);
      }
      if (mod.onWebSocketClose) {
        ctx.onWebSocketClose(mod.onWebSocketClose);
      }
      if (mod.onWebSocketError) {
        ctx.onWebSocketError(mod.onWebSocketError);
      }
      return ctx;
    }
  };
  ctx.clientToProxyWebSocket.on('message', self._onWebSocketFrame.bind(self, ctx, 'message', false));
  ctx.clientToProxyWebSocket.on('ping', self._onWebSocketFrame.bind(self, ctx, 'ping', false));
  ctx.clientToProxyWebSocket.on('pong', self._onWebSocketFrame.bind(self, ctx, 'pong', false));
  ctx.clientToProxyWebSocket.on('error', self._onWebSocketError.bind(self, ctx));
  ctx.clientToProxyWebSocket.on('close', self._onWebSocketClose.bind(self, ctx, false));
  ctx.clientToProxyWebSocket.pause();
  var url;
  if (ctx.clientToProxyWebSocket.upgradeReq.url == '' || /^\//.test(ctx.clientToProxyWebSocket.upgradeReq.url)) {
    var hostPort = Proxy.parseHostAndPort(ctx.clientToProxyWebSocket.upgradeReq);
    url = (ctx.isSSL ? 'wss' : 'ws') + '://' + hostPort.host + (hostPort.port ? ':' + hostPort.port : '') + ctx.clientToProxyWebSocket.upgradeReq.url;
  } else {
    url = ctx.clientToProxyWebSocket.upgradeReq.url;
  }
  var ptosHeaders = {};
  var ctopHeaders = ctx.clientToProxyWebSocket.upgradeReq.headers;
  for (var key in ctopHeaders) {
    if (key.indexOf('sec-websocket') !== 0) {
      ptosHeaders[key] = ctopHeaders[key];
    }
  }
  ctx.proxyToServerWebSocketOptions = {
    url: url,
    agent: ctx.isSSL ? self.httpsAgent : self.httpAgent,
    headers: ptosHeaders
  };
  return self._onWebSocketConnection(ctx, function(err) {
    if (err) {
      return self._onWebSocketError(ctx, err);
    }
    return makeProxyToServerWebSocket();
  });

  function makeProxyToServerWebSocket() {
    ctx.proxyToServerWebSocket = new WebSocket(ctx.proxyToServerWebSocketOptions.url, ctx.proxyToServerWebSocketOptions);
    ctx.proxyToServerWebSocket.on('message', self._onWebSocketFrame.bind(self, ctx, 'message', true));
    ctx.proxyToServerWebSocket.on('ping', self._onWebSocketFrame.bind(self, ctx, 'ping', true));
    ctx.proxyToServerWebSocket.on('pong', self._onWebSocketFrame.bind(self, ctx, 'pong', true));
    ctx.proxyToServerWebSocket.on('error', self._onWebSocketError.bind(self, ctx));
    ctx.proxyToServerWebSocket.on('close', self._onWebSocketClose.bind(self, ctx, true));
    ctx.proxyToServerWebSocket.on('open', function() {
        ctx.clientToProxyWebSocket.resume();
    });
  }
}

Proxy.prototype._onHttpServerRequest = function(isSSL, clientToProxyRequest, proxyToClientResponse) {
  var self = this;
  var ctx = {
    isSSL: isSSL,
    clientToProxyRequest: clientToProxyRequest,
    proxyToClientResponse: proxyToClientResponse,
    onRequestHandlers: [],
    onErrorHandlers: [],
    onRequestDataHandlers: [],
    onRequestEndHandlers: [],
    onResponseHandlers: [],
    onResponseDataHandlers: [],
    onResponseEndHandlers: [],
    requestFilters: [],
    responseFilters: [],
    onRequest: function(fn) {
      ctx.onRequestHandlers.push(fn);
      return ctx;
    },
    onError: function(fn) {
      ctx.onErrorHandlers.push(fn);
      return ctx;
    },
    onRequestData: function(fn) {
      ctx.onRequestDataHandlers.push(fn);
      return ctx;
    },
    onRequestEnd: function(fn) {
      ctx.onRequestEndHandlers.push(fn);
      return ctx;
    },
    addRequestFilter: function(filter) {
      ctx.requestFilters.push(filter);
      return ctx;
    },
    onResponse: function(fn) {
      ctx.onResponseHandlers.push(fn);
      return ctx;
    },
    onResponseData: function(fn) {
      ctx.onResponseDataHandlers.push(fn);
      return ctx;
    },
    onResponseEnd: function(fn) {
      ctx.onResponseEndHandlers.push(fn);
      return ctx;
    },
    addResponseFilter: function(filter) {
      ctx.responseFilters.push(filter);
      return ctx;
    },
    use: function(mod) {
      if (mod.onError) {
        ctx.onError(mod.onError);
      }
      if (mod.onRequest) {
        ctx.onRequest(mod.onRequest);
      }
      if (mod.onRequestHeaders) {
        ctx.onRequestHeaders(mod.onRequestHeaders);
      }
      if (mod.onRequestData) {
        ctx.onRequestData(mod.onRequestData);
      }
      if (mod.onResponse) {
        ctx.onResponse(mod.onResponse);
      }
      if (mod.onResponseData) {
        ctx.onResponseData(mod.onResponseData);
      }
      return ctx;
    }
  };

  ctx.clientToProxyRequest.on('error', self._onError.bind(self, 'CLIENT_TO_PROXY_REQUEST_ERROR', ctx));
  ctx.proxyToClientResponse.on('error', self._onError.bind(self, 'PROXY_TO_CLIENT_RESPONSE_ERROR', ctx));
  ctx.clientToProxyRequest.pause();
  var hostPort = Proxy.parseHostAndPort(ctx.clientToProxyRequest, ctx.isSSL ? 443 : 80);
  ctx.proxyToServerRequestOptions = {
    method: ctx.clientToProxyRequest.method,
    path: ctx.clientToProxyRequest.url,
    host: hostPort.host,
    port: hostPort.port,
    headers: ctx.clientToProxyRequest.headers,
    agent: ctx.isSSL ? self.httpsAgent : self.httpAgent
  };
  return self._onRequest(ctx, function(err) {
    if (err) {
      return self._onError('ON_REQUEST_ERROR', ctx, err);
    }
    return self._onRequestHeaders(ctx, function(err) {
      if (err) {
        return self._onError('ON_REQUESTHEADERS_ERROR', ctx, err);
      }
      return makeProxyToServerRequest();
    });
  });

  function makeProxyToServerRequest() {
    var proto = ctx.isSSL ? https : http;
    ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
    ctx.proxyToServerRequest.on('error', self._onError.bind(self, 'PROXY_TO_SERVER_REQUEST_ERROR', ctx));
    ctx.requestFilters.push(new ProxyFinalRequestFilter(self, ctx));
    var prevRequestPipeElem = ctx.clientToProxyRequest;
    ctx.requestFilters.forEach(function(filter) {
      prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
    });
    ctx.clientToProxyRequest.resume();
  }

  function proxyToServerRequestComplete(serverToProxyResponse) {
    serverToProxyResponse.on('error', self._onError.bind(self, 'SERVER_TO_PROXY_RESPONSE_ERROR', ctx));
    serverToProxyResponse.pause();
    ctx.serverToProxyResponse = serverToProxyResponse;
    return self._onResponse(ctx, function(err) {
      if (err) {
        return self._onError('ON_RESPONSE_ERROR', ctx, err);
      }
      return self._onResponseHeaders(ctx, function (err) {
        if (err) {
          return self._onError('ON_RESPONSEHEADERS_ERROR', ctx, err);
        }
        ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, Proxy.filterAndCanonizeHeaders(ctx.serverToProxyResponse.headers));
        ctx.responseFilters.push(new ProxyFinalResponseFilter(self, ctx));
        var prevResponsePipeElem = ctx.serverToProxyResponse;
        ctx.responseFilters.forEach(function(filter) {
          prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
        });
        return ctx.serverToProxyResponse.resume();
      });
    });
  }
};

var ProxyFinalRequestFilter = function(proxy, ctx) {
  events.EventEmitter.call(this);
  this.writable = true;

  this.write = function(chunk) {
    proxy._onRequestData(ctx, chunk, function(err, chunk) {
      if (err) {
        return proxy._onError('ON_REQUEST_DATA_ERROR', ctx, err);
      }
      if (chunk) {
        return ctx.proxyToServerRequest.write(chunk);
      }
    });
    return true;
  };

  this.end = function(chunk) {
    if (chunk) {
      return proxy._onRequestData(ctx, chunk, function(err, chunk) {
        if (err) {
          return proxy._onError('ON_REQUEST_DATA_ERROR', ctx, err);
        }

        return proxy._onRequestEnd(ctx, function (err) {
          if (err) {
            return proxy._onError('ON_REQUEST_END_ERROR', ctx, err);
          }
          return ctx.proxyToServerRequest.end(chunk);
        });
      });
    } else {
      return proxy._onRequestEnd(ctx, function (err) {
        if (err) {
          return proxy._onError('ON_REQUEST_END_ERROR', ctx, err);
        }
        return ctx.proxyToServerRequest.end(chunk || undefined);
      });
    }
  };
};
util.inherits(ProxyFinalRequestFilter, events.EventEmitter);

var ProxyFinalResponseFilter = function(proxy, ctx) {
  events.EventEmitter.call(this);
  this.writable = true;

  this.write = function(chunk) {
    proxy._onResponseData(ctx, chunk, function(err, chunk) {
      if (err) {
        return proxy._onError('ON_RESPONSE_DATA_ERROR', ctx, err);
      }
      if (chunk) {
        return ctx.proxyToClientResponse.write(chunk);
      }
    });
    return true;
  };

  this.end = function(chunk) {
    if (chunk) {
      return proxy._onResponseData(ctx, chunk, function(err, chunk) {
        if (err) {
          return proxy._onError('ON_RESPONSE_DATA_ERROR', ctx, err);
        }

        return proxy._onResponseEnd(ctx, function (err) {
          if (err) {
            return proxy._onError('ON_RESPONSE_END_ERROR', ctx, err);
          }
          return ctx.proxyToClientResponse.end(chunk || undefined);
        });
      });
    } else {
      return proxy._onResponseEnd(ctx, function (err) {
        if (err) {
          return proxy._onError('ON_RESPONSE_END_ERROR', ctx, err);
        }
        return ctx.proxyToClientResponse.end(chunk || undefined);
      });
    }
  };

  return this;
};
util.inherits(ProxyFinalResponseFilter, events.EventEmitter);

Proxy.prototype._onRequestHeaders = function(ctx, callback) {
  async.forEach(this.onRequestHeadersHandlers, function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onRequest = function(ctx, callback) {
  async.forEach(this.onRequestHandlers.concat(ctx.onRequestHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onWebSocketConnection = function(ctx, callback) {
  async.forEach(this.onWebSocketConnectionHandlers.concat(ctx.onWebSocketConnectionHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onWebSocketFrame = function(ctx, type, fromServer, data, flags) {
  var self = this;
  async.forEach(this.onWebSocketFrameHandlers.concat(ctx.onWebSocketFrameHandlers), function(fn, callback) {
    return fn(ctx, type, fromServer, data, flags, function(err, newData, newFlags) {
      if (err) {
        return callback(err);
      }
      data = newData;
      flags = newFlags;
      return callback(null, data, flags);
    });
  }, function(err) {
    if (err) {
      return self._onWebSocketError(ctx, err);
    }
    var destWebSocket = fromServer ? ctx.clientToProxyWebSocket : ctx.proxyToServerWebSocket;
    if (destWebSocket.readyState === WebSocket.OPEN) {
      switch(type) {
        case 'message': destWebSocket.send(data, flags);
        break;
        case 'ping': destWebSocket.ping(data, flags, false);
        break;
        case 'pong': destWebSocket.pong(data, flags, false);
        break;
      }
    } else {
      self._onWebSocketError(ctx, new Error('Cannot send ' + type + ' because ' + (fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN'));
    }
  });
};

Proxy.prototype._onWebSocketClose = function(ctx, closedByServer, code, message) {
  if (!ctx.closedByServer && !ctx.closedByClient) {
    ctx.closedByServer = closedByServer;
    ctx.closedByClient = !closedByServer;
    async.forEach(this.onWebSocketCloseHandlers.concat(ctx.onWebSocketCloseHandlers), function(fn, callback) {
      return fn(ctx, code, message, callback);
    }, function(err, code, message) {
      if (err) {
        return self._onWebSocketError(ctx, err);
      }
      if (ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
        if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
          ctx.proxyToServerWebSocket.close(code, message);
        } else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
          ctx.clientToProxyWebSocket.close(code, message);
        }
      }
    });
  }
};

Proxy.prototype._onWebSocketError = function(ctx, err) {
  this.onWebSocketErrorHandlers.forEach(function(handler) {
    return handler(ctx, err);
  });
  if (ctx) {
    ctx.onWebSocketErrorHandlers.forEach(function(handler) {
      return handler(ctx, err);
    });
  }
  if (ctx.proxyToServerWebSocket && ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
    if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
      ctx.proxyToServerWebSocket.close();
    } else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
      ctx.clientToProxyWebSocket.close();
    }
  }
};

Proxy.prototype._onRequestData = function(ctx, chunk, callback) {
  var self = this;
  async.forEach(this.onRequestDataHandlers.concat(ctx.onRequestDataHandlers), function(fn, callback) {
    return fn(ctx, chunk, function(err, newChunk) {
      if (err) {
        return callback(err);
      }
      chunk = newChunk;
      return callback(null, newChunk);
    });
  }, function(err) {
    if (err) {
      return self._onError('ON_REQUEST_DATA_ERROR', ctx, err);
    }
    return callback(null, chunk);
  });
};

Proxy.prototype._onRequestEnd = function(ctx, callback) {
  var self = this;
  async.forEach(this.onRequestEndHandlers.concat(ctx.onRequestEndHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, function(err) {
    if (err) {
      return self._onError('ON_REQUEST_END_ERROR', ctx, err);
    }
    return callback(null);
  });
};

Proxy.prototype._onResponse = function(ctx, callback) {
  async.forEach(this.onResponseHandlers.concat(ctx.onResponseHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onResponseHeaders = function(ctx, callback) {
  async.forEach(this.onResponseHeadersHandlers, function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onResponseData = function(ctx, chunk, callback) {
  var self = this;
  async.forEach(this.onResponseDataHandlers.concat(ctx.onResponseDataHandlers), function(fn, callback) {
    return fn(ctx, chunk, function(err, newChunk) {
      if (err) {
        return callback(err);
      }
      chunk = newChunk;
      return callback(null, newChunk);
    });
  }, function(err) {
    if (err) {
      return self._onError('ON_RESPONSE_DATA_ERROR', ctx, err);
    }
    return callback(null, chunk);
  });
};

Proxy.prototype._onResponseEnd = function(ctx, callback) {
  var self = this;
  async.forEach(this.onResponseEndHandlers.concat(ctx.onResponseEndHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, function(err) {
    if (err) {
      return self._onError('ON_RESPONSE_END_ERROR', ctx, err);
    }
    return callback(null);
  });
};

Proxy.parseHostAndPort = function(req, defaultPort) {
  var host = req.headers.host;
  if (!host) {
    return null;
  }
  var hostPort = Proxy.parseHost(host, defaultPort);

  // this handles paths which include the full url. This could happen if it's a proxy
  var m = req.url.match(/^http:\/\/([^\/]*)\/?(.*)$/);
  if (m) {
    var parsedUrl = url.parse(req.url);
    hostPort.host = parsedUrl.hostname;
    hostPort.port = parsedUrl.port;
    req.url = parsedUrl.path;
  }

  return hostPort;
};

Proxy.parseHost = function(hostString, defaultPort) {
  var m = hostString.match(/^http:\/\/(.*)/);
  if (m) {
    var parsedUrl = url.parse(hostString);
    return {
      host: parsedUrl.hostname,
      port: parsedUrl.port
    };
  }

  var hostPort = hostString.split(':');
  var host = hostPort[0];
  var port = hostPort.length === 2 ? +hostPort[1] : defaultPort;

  return {
    host: host,
    port: port
  };
};

Proxy.filterAndCanonizeHeaders = function(originalHeaders) {
  var headers = {};
  for (var key in originalHeaders) {
    var canonizedKey = key.trim();
    if (/^public\-key\-pins/i.test(canonizedKey)) {
      // KPKP header => filter
      continue;
    }
    headers[canonizedKey] = originalHeaders[key];
  }
  return headers;
};

Proxy.NAMED_SOCKET_PREFIX = 'mitm-proxy-' + Math.random().toString(36).substring(2, 10);
Proxy.NAMED_SOCKET_INDEX = 0;
Proxy.newNamedSocket = function() {
  var socketName = Proxy.NAMED_SOCKET_PREFIX + "-" + Proxy.NAMED_SOCKET_INDEX++;
  if (/^win/.test(process.platform)) {
    return '\\\\.\\pipe\\' + socketName + '-sock';
  } else {
    return path.join(os.tmpdir(), socketName+".sock")
  }
};
