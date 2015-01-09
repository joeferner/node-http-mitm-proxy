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
var url = require('url');

module.exports = function() {
  return new Proxy();
};

module.exports.gunzip = require('./middleware/gunzip');

var Proxy = function() {
  this.onRequestHandlers = [];
  this.onErrorHandlers = [];
  this.onRequestDataHandlers = [];
  this.onResponseHandlers = [];
  this.onResponseDataHandlers = [];
};

Proxy.prototype.listen = function(options) {
  var self = this;
  this.options = options || {};
  this.httpPort = options.port || 8080;
  this.sslCertCacheDir = options.sslCertCacheDir || path.resolve(process.env['HOME'], '.http-mitm-proxy');
  this.sslServers = {};
  mkdirps(this.sslCertCacheDir, function(err) {
    if (err) {
      self._onError(null, err);
    }
    self.httpServer = http.createServer();
    self.httpServer.on('connect', self._onHttpServerConnect.bind(self));
    self.httpServer.on('request', self._onHttpServerRequest.bind(self, false));
    self.httpServer.listen(self.httpPort);
  });
};

Proxy.prototype.onError = function(fn) {
  this.onErrorHandlers.push(fn);
};

Proxy.prototype.onRequest = function(fn) {
  this.onRequestHandlers.push(fn);
};

Proxy.prototype.onRequestData = function(fn) {
  this.onRequestDataHandlers.push(fn);
};

Proxy.prototype.onResponse = function(fn) {
  this.onResponseHandlers.push(fn);
};

Proxy.prototype.onResponseData = function(fn) {
  this.onResponseDataHandlers.push(fn);
};

Proxy.prototype.use = function(mod) {
  if (mod.onError) {
    this.onError(mod.onError);
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
};

Proxy.prototype._onHttpServerConnect = function(req, socket, head) {
  var self = this;

  // URL is in the form 'hostname:port'
  var parts = req.url.split(':', 2);
  var hostname = parts[0];
  var port = parts[1] || 80;

  if (port == 443) {
    var sslServer = this.sslServers[hostname];
    if (sslServer) {
      return makeConnection(sslServer.port);
    } else {
      return openHttpsServer(hostname, function(err, port) {
        if (err) {
          return self._onError(null, err);
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
      // respond to the client that the connection was made
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      // create a tunnel between the two hosts
      socket.pipe(conn);
      return conn.pipe(socket);
    });
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
              'data': data,
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
        console.log('starting server for ' + hostname);
        var httpsServer = https.createServer(results.httpsOptions);
        httpsServer.on('connect', self._onHttpServerConnect.bind(self));
        httpsServer.on('request', self._onHttpServerRequest.bind(self, true));
        httpsServer.listen(function() {
          results.openPort = httpsServer.address().port;
          console.log('server started for %s on port %d', hostname, results.openPort);

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

Proxy.prototype.onCertificateRequired = function(hostname, callback) {
  var self = this;

  return callback(null, {
    keyFile: path.resolve(self.sslCertCacheDir, hostname + '-key.pem'),
    certFile: path.resolve(self.sslCertCacheDir, hostname + '-cert.pem')
  });
};

Proxy.prototype.onCertificateMissing = function(ctx, files, callback) {
  if (!ctx.data.keyFileExists && !ctx.data.certFileExists) {
    return callback(new Error("could not find file: " + files.keyFile + " and " + files.certFile));
  } else if (!ctx.data.keyFileExists) {
    return callback(new Error("could not find file: " + files.keyFile));
  } else {
    return callback(new Error("could not find file: " + files.certFile));
  }
};

Proxy.prototype._onError = function(ctx, err) {
  this.onErrorHandlers.forEach(function(handler) {
    return handler(ctx, err);
  });
  if (ctx) {
    ctx.onErrorHandlers.forEach(function(handler) {
      return handler(ctx, err);
    });
  }
};

Proxy.prototype._onHttpServerRequest = function(isSSL, clientToProxyRequest, proxyToClientResponse) {
  var self = this;
  var ctx = {
    isSSL: isSSL,
    clientToProxyRequest: clientToProxyRequest,
    proxyToClientResponse: proxyToClientResponse,
    onRequestHandlers: [],
    onErrorHandlers: [],
    onRequestDataHandlers: [],
    onResponseHandlers: [],
    onResponseDataHandlers: [],
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
    addRequestFilter: function(filter) {
      ctx.requestFilters.push(filter);
    },
    onResponse: function(fn) {
      ctx.onResponseHandlers.push(fn);
    },
    onResponseData: function(fn) {
      ctx.onResponseDataHandlers.push(fn);
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
      return self._onError(ctx, err);
    }
    return makeProxyToServerRequest();
  });

  function makeProxyToServerRequest() {
    var proto = ctx.isSSL ? https : http;
    ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
    ctx.requestFilters.push(new ProxyFinalRequestFilter(self, ctx));
    var prevRequestPipeElem = ctx.clientToProxyRequest;
    ctx.requestFilters.forEach(function(filter, i) {
      prevRequestPipeElem.pipe(filter);
      prevRequestPipeElem = filter;
    });
    ctx.clientToProxyRequest.resume();
    return true;
  }

  function proxyToServerRequestComplete(serverToProxyResponse) {
    serverToProxyResponse.pause();
    ctx.serverToProxyResponse = serverToProxyResponse;
    return self._onResponse(ctx, function(err) {
      if (err) {
        return self._onError(ctx, err);
      }
      ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked';
      ctx.serverToProxyResponse.headers['connection'] = 'close';
      ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, ctx.serverToProxyResponse.headers);
      ctx.responseFilters.push(new ProxyFinalResponseFilter(self, ctx));
      var prevResponsePipeElem = ctx.serverToProxyResponse;
      ctx.responseFilters.forEach(function(filter, i) {
        prevResponsePipeElem.pipe(filter);
        prevResponsePipeElem = filter;
      });
      return ctx.serverToProxyResponse.resume();
    });
  }
};

var ProxyFinalRequestFilter = function(proxy, ctx) {
  events.EventEmitter.call(this);
  this.writable = true;

  this.write = function(chunk) {
    proxy._onRequestData(ctx, chunk, function(err, chunk) {
      if (err) {
        return proxy._onError(ctx, err);
      }
      return ctx.proxyToServerRequest.write(chunk);
    });
    return true;
  };

  this.end = function(chunk) {
    if (chunk) {
      return proxy._onRequestData(ctx, chunk, function(err, chunk) {
        if (err) {
          return self._onError(ctx, err);
        }
        return ctx.proxyToServerRequest.end(chunk);
      });
    } else {
      return ctx.proxyToServerRequest.end(chunk);
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
        return self._onError(ctx, err);
      }
      return ctx.proxyToClientResponse.write(chunk);
    });
    return true;
  };

  this.end = function(chunk) {
    if (chunk) {
      return proxy._onResponseData(ctx, chunk, function(err, chunk) {
        if (err) {
          return self._onError(ctx, err);
        }
        return ctx.proxyToClientResponse.end(chunk);
      });
    } else {
      return ctx.proxyToClientResponse.end(chunk);
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

Proxy.prototype._onRequestData = function(ctx, chunk, callback) {
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
      return self._onError(ctx, err);
    }
    return callback(null, chunk);
  });
};

Proxy.prototype._onResponse = function(ctx, callback) {
  async.forEach(this.onResponseHandlers.concat(ctx.onResponseHandlers), function(fn, callback) {
    return fn(ctx, callback);
  }, callback);
};

Proxy.prototype._onResponseData = function(ctx, chunk, callback) {
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
      return self._onError(ctx, err);
    }
    return callback(null, chunk);
  });
};

Proxy.parseHostAndPort = function(req, defaultPort) {
  var host = req.headers.host;
  if (!host) {
    req.writeHead(404);
    req.end("404 - Not Found");
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
    var parsedUrl = url.parse(req.url);
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
