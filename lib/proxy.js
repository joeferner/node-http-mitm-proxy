'use strict';

var async = require('async');
var net = require('net');
var http = require('http');
var https = require('https');
var util = require('util');
var fs = require('fs');
var path = require('path');
var events = require("events");
var mkdirps = require('mkdirps');
var WebSocket = require('ws');
var url = require('url');
var ca = require('./ca.js');

module.exports = function() {
  return new Proxy();
};

module.exports.gunzip = require('./middleware/gunzip');

var Proxy = function() {
  this.onRequestHandlers = [];
  this.onWebSocketConnectionHandlers = [];
  this.onWebSocketSendHandlers = [];
  this.onWebSocketMessageHandlers = [];
  this.onWebSocketCloseHandlers = [];
  this.onWebSocketErrorHandlers = [];
  this.onErrorHandlers = [];
  this.onRequestDataHandlers = [];
  this.onRequestEndHandlers = [];
  this.onResponseHandlers = [];
  this.onResponseDataHandlers = [];
  this.onResponseEndHandlers = [];
};

Proxy.prototype.listen = function(options) {
  var self = this;
  this.options = options || {};
  this.silent = !!options.silent;
  this.httpPort = options.port || 8080;
  this.sslCaDir = options.sslCaDir || path.resolve(process.cwd(), '.http-mitm-proxy');
  this.ca = new ca(this.sslCaDir);
  this.sslServers = {};
  mkdirps(this.sslCaDir, function(err) {
    if (err) {
      self._onError("CERT_DIRECTORY_CREATION", null, err);
    }
    self.httpServer = http.createServer();
    self.httpServer.on('error', self._onError.bind(self, "HTTP_SERVER_ERROR", null));
    self.httpServer.on('connect', self._onHttpServerConnect.bind(self));
    self.httpServer.on('request', self._onHttpServerRequest.bind(self, false));
    self.wsServer = new WebSocket.Server({ server: self.httpServer });
    self.wsServer.on('connection', self._onWebSocketServerConnect.bind(self, false));
    self.httpServer.listen(self.httpPort);
  });
};

Proxy.prototype.onError = function(fn) {
  this.onErrorHandlers.push(fn);
};

Proxy.prototype.onRequest = function(fn) {
  this.onRequestHandlers.push(fn);
};

Proxy.prototype.onWebSocketConnection = function(fn) {
  this.onWebSocketConnectionHandlers.push(fn);
};

Proxy.prototype.onWebSocketSend = function(fn) {
  this.onWebSocketSendHandlers.push(fn);
};

Proxy.prototype.onWebSocketMessage = function(fn) {
  this.onWebSocketMessageHandlers.push(fn);
};

Proxy.prototype.onWebSocketClose = function(fn) {
  this.onWebSocketCloseHandlers.push(fn);
};

Proxy.prototype.onWebSocketError = function(fn) {
  this.onWebSocketErrorHandlers.push(fn);
};

Proxy.prototype.onRequestData = function(fn) {
  this.onRequestDataHandlers.push(fn);
};

Proxy.prototype.onRequestEnd = function(fn) {
  this.onRequestEndHandlers.push(fn);
};

Proxy.prototype.onResponse = function(fn) {
  this.onResponseHandlers.push(fn);
};

Proxy.prototype.onResponseData = function(fn) {
  this.onResponseDataHandlers.push(fn);
};

Proxy.prototype.onResponseEnd = function(fn) {
  this.onResponseEndHandlers.push(fn);
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
  if (mod.onRequestData) {
    this.onRequestData(mod.onRequestData);
  }
  if (mod.onResponse) {
    this.onResponse(mod.onResponse);
  }
  if (mod.onResponseData) {
    this.onResponseData(mod.onResponseData);
  }
  if (mod.onWebSocketConnection) {
    this.onWebSocketConnection(mod.onWebSocketConnection);
  }
  if (mod.onWebSocketSend) {
    this.onWebSocketSend(mod.onWebSocketSend);
  }
  if (mod.onWebSocketMessage) {
    this.onWebSocketMessage(mod.onWebSocketMessage);
  }
  if (mod.onWebSocketClose) {
    this.onWebSocketClose(mod.onWebSocketClose);
  }
  if (mod.onWebSocketError) {
    this.onWebSocketError(mod.onWebSocketError);
  }
};

Proxy.prototype._onHttpServerConnect = function(req, socket, head) {
  var self = this;
  
  // we need first byte of data to detect if request is SSL encrypted
  if (!head || head.length === 0) {
    socket.once('data', function(data) {
      self._onHttpServerConnect(req, socket, data);
    });
    // respond to the client that the connection was made so it can send us data
    return socket.write("HTTP/1.1 200 OK\r\n\r\n");
  }

  socket.pause();

  // URL is in the form 'hostname:port'
  var hostname = req.url.split(':', 2)[0];

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
    var sslServer = this.sslServers[hostname];
    if (sslServer) {
      return makeConnection(sslServer.port);
    } else {
      return openHttpsServer(hostname, function(err, port) {
        if (err) {
          return self._onError("OPEN_HTTPS_SERVER_ERROR", null, err);
        }
        return makeConnection(port);
      });
    }
  } else {
    return makeConnection(this.httpPort);
  }

  function makeConnection(port) {
    // open a TCP connection to the remote host
    var conn = net.connect(port, 'localhost', function() {
      // create a tunnel between the two hosts
      socket.pipe(conn);
      conn.pipe(socket);
      socket.emit('data', head);
      return socket.resume();
    });
    conn.on('error', self._onError.bind(self, "PROXY_TO_PROXY_SOCKET_ERROR", null));
  }

  function openHttpsServer(hostname, callback) {
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
                  cert: certFileData
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
                cert: files.certFileData
              });
            });
          }
        }]
      }, function(err, results) {
        if (err) {
          return callback(err);
        }
        if (!self.silent) {
          console.log('starting server for ' + hostname);
        }
        var httpsServer = https.createServer(results.httpsOptions);
        httpsServer.on('error', self._onError.bind(self, "HTTPS_SERVER_ERROR", null));
        httpsServer.on('clientError', self._onError.bind(self, "HTTPS_CLIENT_ERROR", null));
        httpsServer.on('connect', self._onHttpServerConnect.bind(self));
        httpsServer.on('request', self._onHttpServerRequest.bind(self, true));
        self.wssServer = new WebSocket.Server({ server: httpsServer });
        self.wssServer.on('connection', self._onWebSocketServerConnect.bind(self, true));
        httpsServer.listen(function() {
          results.openPort = httpsServer.address().port;
          if (!self.silent) {
            console.log('server started for %s on port %d', hostname, results.openPort);
          }
          self.sslServers[hostname] = {
            port: results.openPort,
            server: httpsServer
          };
          callback(null, results.openPort);
        });
      });
    });
  }
};

Proxy.prototype.onCertificateRequired = function (hostname, callback) {
  var self = this;
  return callback(null, {
    keyFile: self.sslCaDir + '/keys/' + hostname + '.key',
    certFile: self.sslCaDir + '/certs/' + hostname + '.pem'
  });
};
Proxy.prototype.onCertificateMissing = function (ctx, files, callback) {
  this.ca.getServerCertificateKeys(ctx.hostname, function (certPEM, privateKeyPEM) {
    callback(null, {
      certFileData: certPEM,
      keyFileData: privateKeyPEM
    });
  });
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
      ctx.proxyToClientResponse.writeHead(504, "Proxy Error");
    }
    if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
      ctx.proxyToClientResponse.end(""+kind+": "+err, "utf8");
    }
  }
};

Proxy.prototype._onWebSocketServerConnect = function(isSSL, ws) {
  var self = this;
  var ctx = {
    isSSL: isSSL,
    clientToProxyWebSocket: ws,
    onWebSocketConnectionHandlers: [],
    onWebSocketSendHandlers: [],
    onWebSocketMessageHandlers: [],
    onWebSocketCloseHandlers: [],
    onWebSocketErrorHandlers: [],
    onWebSocketConnection: function(fn) {
      ctx.onWebSocketConnectionHandlers.push(fn);
    },
    onWebSocketSend: function(fn) {
      ctx.onWebSocketSendHandlers.push(fn);
    },
    onWebSocketMessage: function(fn) {
      ctx.onWebSocketMessageHandlers.push(fn);
    },
    onWebSocketClose: function(fn) {
      ctx.onWebSocketCloseHandlers.push(fn);
    },
    onWebSocketError: function(fn) {
      ctx.onWebSocketErrorHandlers.push(fn);
    },
    use: function(mod) {
      if (mod.onWebSocketConnection) {
        ctx.onWebSocketConnection(mod.onWebSocketConnection);
      }
      if (mod.onWebSocketSend) {
        ctx.onWebSocketSend(mod.onWebSocketSend);
      }
      if (mod.onWebSocketMessage) {
        ctx.onWebSocketMessage(mod.onWebSocketMessage);
      }
      if (mod.onWebSocketClose) {
        ctx.onWebSocketClose(mod.onWebSocketClose);
      }
      if (mod.onWebSocketError) {
        ctx.onWebSocketError(mod.onWebSocketError);
      }
    }
  };
  ctx.clientToProxyWebSocket.on('message', self._onWebSocketSend.bind(self, ctx));
  ctx.clientToProxyWebSocket.on('error', self._onWebSocketError.bind(self, ctx));
  ctx.clientToProxyWebSocket.on('close', self._onWebSocketClose.bind(self, ctx, false));
  ctx.clientToProxyWebSocket.pause();
  var url;
  if (ctx.clientToProxyWebSocket.upgradeReq.url == "" || /^\//.test(ctx.clientToProxyWebSocket.upgradeReq.url)) {
    var hostPort = Proxy.parseHostAndPort(ctx.clientToProxyWebSocket.upgradeReq);
    url = (ctx.isSSL ? "wss" : "ws") + "://" + hostPort.host + (hostPort.port ? ":" + hostPort.port : "") + ctx.clientToProxyWebSocket.upgradeReq.url;
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
    agent: false,
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
    ctx.proxyToServerWebSocket.on('message', self._onWebSocketMessage.bind(self, ctx));
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
    },
    onError: function(fn) {
      ctx.onErrorHandlers.push(fn);
    },
    onRequestData: function(fn) {
      ctx.onRequestDataHandlers.push(fn);
    },
    onRequestEnd: function(fn) {
      ctx.onRequestEndHandlers.push(fn);
    },
    addRequestFilter: function(filter) {
      ctx.requestFilters.push(filter);
    },
    onResponse: function(fn) {
      ctx.onResponseHandlers.push(fn);
    },
    onResponseData: function(fn) {
      ctx.onResponseDataHandlers.push(fn);
    },
    onResponseEnd: function(fn) {
      ctx.onResponseEndHandlers.push(fn);
    },
    addResponseFilter: function(filter) {
      ctx.responseFilters.push(filter);
    },
    use: function(mod) {
      if (mod.onError) {
        ctx.onError(mod.onError);
      }
      if (mod.onRequest) {
        ctx.onRequest(mod.onRequest);
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
    }
  };

  ctx.clientToProxyRequest.on('error', self._onError.bind(self, "CLIENT_TO_PROXY_REQUEST_ERROR", ctx));
  ctx.proxyToClientResponse.on('error', self._onError.bind(self, "PROXY_TO_CLIENT_RESPONSE_ERROR", ctx));
  ctx.clientToProxyRequest.pause();
  var hostPort = Proxy.parseHostAndPort(ctx.clientToProxyRequest, ctx.isSSL ? 443 : 80);
  ctx.proxyToServerRequestOptions = {
    method: ctx.clientToProxyRequest.method,
    path: ctx.clientToProxyRequest.url,
    host: hostPort.host,
    port: hostPort.port,
    headers: ctx.clientToProxyRequest.headers,
    agent: false
  };
  return self._onRequest(ctx, function(err) {
    if (err) {
      return self._onError("ON_REQUEST_ERROR", ctx, err);
    }
    return makeProxyToServerRequest();
  });

  function makeProxyToServerRequest() {
    var proto = ctx.isSSL ? https : http;
    ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
    ctx.proxyToServerRequest.on('error', self._onError.bind(self, "PROXY_TO_SERVER_REQUEST_ERROR", ctx));
    ctx.requestFilters.push(new ProxyFinalRequestFilter(self, ctx));
    var prevRequestPipeElem = ctx.clientToProxyRequest;
    ctx.requestFilters.forEach(function(filter) {
      prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
    });
    ctx.clientToProxyRequest.resume();
  }

  function proxyToServerRequestComplete(serverToProxyResponse) {
    serverToProxyResponse.on('error', self._onError.bind(self, "SERVER_TO_PROXY_RESPONSE_ERROR", ctx));
    serverToProxyResponse.pause();
    ctx.serverToProxyResponse = serverToProxyResponse;
    return self._onResponse(ctx, function(err) {
      if (err) {
        return self._onError("ON_RESPONSE_ERROR", ctx, err);
      }
      ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked';
      ctx.serverToProxyResponse.headers['connection'] = 'close';
      ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, canonizeHeaders(ctx.serverToProxyResponse.headers));
      ctx.responseFilters.push(new ProxyFinalResponseFilter(self, ctx));
      var prevResponsePipeElem = ctx.serverToProxyResponse;
      ctx.responseFilters.forEach(function(filter) {
        prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
      });
      return ctx.serverToProxyResponse.resume();
    });
  }
};

var canonizeHeaders = function(originalHeaders) {
  var headers = {};
  for (var key in originalHeaders) {
    headers[key.trim()] = originalHeaders[key];
  }

  return headers;
}

var ProxyFinalRequestFilter = function(proxy, ctx) {
  events.EventEmitter.call(this);
  this.writable = true;

  this.write = function(chunk) {
    proxy._onRequestData(ctx, chunk, function(err, chunk) {
      if (err) {
        return proxy._onError("ON_REQUEST_DATA_ERROR", ctx, err);
      }
      return ctx.proxyToServerRequest.write(chunk);
    });
    return true;
  };

  this.end = function(chunk) {
    if (chunk) {
      return proxy._onRequestData(ctx, chunk, function(err, chunk) {
        if (err) {
          return proxy._onError("ON_REQUEST_DATA_ERROR", ctx, err);
        }

        return proxy._onRequestEnd(ctx, function (err) {
          if (err) {
            return proxy._onError("ON_REQUEST_END_ERROR", ctx, err);
          }
          return ctx.proxyToServerRequest.end(chunk);
        });
      });
    } else {
      return proxy._onRequestEnd(ctx, function (err) {
        if (err) {
          return proxy._onError("ON_REQUEST_END_ERROR", ctx, err);
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
        return proxy._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
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
          return proxy._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
        }

        return proxy._onResponseEnd(ctx, function (err) {
          if (err) {
            return proxy._onError("ON_RESPONSE_END_ERROR", ctx, err);
          }
          return ctx.proxyToClientResponse.end(chunk || undefined);
        });
      });
    } else {
      return proxy._onResponseEnd(ctx, function (err) {
        if (err) {
          return proxy._onError("ON_RESPONSE_END_ERROR", ctx, err);
        }
        return ctx.proxyToClientResponse.end(chunk || undefined);
      });
    }
  };

  return this;
};
util.inherits(ProxyFinalResponseFilter, events.EventEmitter);

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

Proxy.prototype._onWebSocketSend = function(ctx, data, flags) {
  var self = this;
  async.forEach(this.onWebSocketSendHandlers.concat(ctx.onWebSocketSendHandlers), function(fn, callback) {
    return fn(ctx, data, flags, function(err, newData, newFlags) {
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
    if (ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
      ctx.proxyToServerWebSocket.send(data, flags);
    } else {
      self._onWebSocketError(ctx, new Error("Cannot send message because proxyToServer WebSocket connection state is not OPEN"));
    }
  });
};

Proxy.prototype._onWebSocketMessage = function(ctx, data, flags) {
  var self = this;
  async.forEach(this.onWebSocketMessageHandlers.concat(ctx.onWebSocketMessageHandlers), function(fn, callback) {
    return fn(ctx, data, flags, function(err, newData, newFlags) {
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
    if (ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
      ctx.clientToProxyWebSocket.send(data, flags);
    } else {
      self._onWebSocketError(ctx, new Error("Cannot receive message because clientToProxy WebSocket connection state is not OPEN"));
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
      return self._onError("ON_REQUEST_DATA_ERROR", ctx, err);
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
      return self._onError("ON_REQUEST_END_ERROR", ctx, err);
    }
    return callback(null);
  });
};

Proxy.prototype._onResponse = function(ctx, callback) {
  async.forEach(this.onResponseHandlers.concat(ctx.onResponseHandlers), function(fn, callback) {
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
      return self._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
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
      return self._onError("ON_RESPONSE_END_ERROR", ctx, err);
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
