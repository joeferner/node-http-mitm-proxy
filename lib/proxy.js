'use strict';

var async = require('async');
var net = require('net');
var http = require('http');

module.exports = function() {
  return new Proxy();
};

var Proxy = function() {
  this.onRequestHandlers = [];
  this.onErrorHandlers = [];
  this.onRequestDataHandlers = [];
  this.onResponseHandlers = [];
  this.onResponseDataHandlers = [];
};

Proxy.prototype.listen = function(port) {
  this.port = port;

  this.httpServer = http.createServer();
  this.httpServer.on('connect', this._onHttpServerConnect.bind(this));
  this.httpServer.on('request', this._onHttpServerRequest.bind(this));
  this.httpServer.listen(this.port);
};

Proxy.prototype.onRequest = function(fn) {
  this.onRequestHandlers.push(fn);
};

Proxy.prototype.onError = function(fn) {
  this.onErrorHandlers.push(fn);
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

Proxy.prototype._onHttpServerConnect = function(req, socket, head) {
  // URL is in the form 'hostname:port'
  var parts = req.url.split(':', 2);
  var hostname = parts[0];
  var port = parts[1] || 80;

  // open a TCP connection to the remote host
  var conn = net.connect(port, hostname, function() {
    // respond to the client that the connection was made
    socket.write("HTTP/1.1 200 OK\r\n\r\n");
    // create a tunnel between the two hosts
    socket.pipe(conn);
    return conn.pipe(socket);
  });
};

Proxy.prototype._onError = function(ctx, err) {
  this.onErrorHandlers.forEach(function(handler) {
    return handler(ctx, err);
  });
  ctx.onErrorHandlers.forEach(function(handler) {
    return handler(ctx, err);
  });
};

Proxy.prototype._onHttpServerRequest = function(clientToProxyRequest, proxyToClientResponse) {
  var self = this;
  var ctx = {
    clientToProxyRequest: clientToProxyRequest,
    proxyToClientResponse: proxyToClientResponse,
    onRequestHandlers: [],
    onErrorHandlers: [],
    onRequestDataHandlers: [],
    onResponseHandlers: [],
    onResponseDataHandlers: [],
    onRequest: function(fn) {
      ctx.onRequestHandlers.push(fn);
    },
    onError: function(fn) {
      ctx.onErrorHandlers.push(fn);
    },
    onRequestData: function(fn) {
      ctx.onRequestDataHandlers.push(fn);
    },
    onResponse: function(fn) {
      ctx.onResponseHandlers.push(fn);
    },
    onResponseData: function(fn) {
      ctx.onResponseDataHandlers.push(fn);
    }
  };

  ctx.clientToProxyRequest.pause();
  var hostPort = Proxy.parseHostAndPort(ctx.clientToProxyRequest);
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
    ctx.proxyToServerRequest = http.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
    ctx.clientToProxyRequest.on('data', function(chunk) {
      return self._onRequestData(ctx, chunk, function(err, chunk) {
        if (err) {
          return self._onError(ctx, err);
        }
        return ctx.proxyToServerRequest.write(chunk);
      });
    });
    ctx.clientToProxyRequest.on('end', function(chunk) {
      if (chunk) {
        return self._onRequestData(ctx, chunk, function(err, chunk) {
          if (err) {
            return self._onError(ctx, err);
          }
          return ctx.proxyToServerRequest.end(chunk);
        });
      } else {
        return ctx.proxyToServerRequest.end(chunk);
      }
    });
    ctx.clientToProxyRequest.resume();
    return true;

    function proxyToServerRequestComplete(serverToProxyResponse) {
      ctx.serverToProxyResponse = serverToProxyResponse;
      return self._onResponse(ctx, function(err) {
        if (err) {
          return self._onError(ctx, err);
        }
        ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, ctx.serverToProxyResponse.headers);
        ctx.serverToProxyResponse.on('data', function(chunk) {
          return self._onResponseData(ctx, chunk, function(err, chunk) {
            if (err) {
              return self._onError(ctx, err);
            }
            return ctx.proxyToClientResponse.write(chunk);
          });
        });
        ctx.serverToProxyResponse.on('end', function(chunk) {
          if (chunk) {
            return self._onResponseData(ctx, chunk, function(err, chunk) {
              if (err) {
                return self._onError(ctx, err);
              }
              return ctx.proxyToClientResponse.end(chunk);
            });
          } else {
            return ctx.proxyToClientResponse.end(chunk);
          }
        });
        return ctx.serverToProxyResponse.resume();
      });
    }
  }
};

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
      return 0;
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
      return 0;
    });
  }, function(err) {
    if (err) {
      return self._onError(ctx, err);
    }
    return callback(null, chunk);
  });
};

Proxy.parseHostAndPort = function(req) {
  var host = req.headers.host;
  if (!host) {
    req.writeHead(404);
    req.end("404 - Not Found");
    return null;
  }
  var hostPort = Proxy.parseHost(host);

  // this handles paths which include the full url. This could happen if it's a proxy
  var m = req.url.match(/^http:\/\/([^\/]*)\/?(.*)$/);
  if (m) {
    hostPort.host = m[1];
    req.url = '/' + m[2];
  }

  return hostPort;
};

Proxy.parseHost = function(hostString) {
  var m = hostString.match(/^http:\/\/(.*)/);
  if (m) {
    hostString = m[1];
  }

  var hostPort = hostString.split(':');
  var host = hostPort[0];
  var port = hostPort.length === 2 ? +hostPort[1] : 80;

  return {
    host: host,
    port: port
  };
};
