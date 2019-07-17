var util = require('util');
var assert = require('assert');
var crypto = require('crypto');
var zlib = require('zlib');
var request = require('request');
var fs = require('fs');
var http = require('http');
var net = require('net');
var nodeStatic = require('node-static');
var WebSocket = require('ws');
var Proxy = require('../');
var fileStaticA = new nodeStatic.Server(__dirname + '/wwwA');
var fileStaticB = new nodeStatic.Server(__dirname + '/wwwB');
var testHost = '127.0.0.1';
var testHostName = 'localhost';
var testPortA = 40005;
var testPortB = 40006;
var testProxyPort = 40010;
var testWSPort = 40007;
var testUrlA = 'http://' + testHost + ':' + testPortA;
var testUrlB = 'http://' + testHost + ':' + testPortB;

var getHttp = function (url, cb) {
  request({ url: url }, function (err, resp, body) {
    cb(err, resp, body);
  });
};

var proxyHttp = function (url, keepAlive, cb) {
  request({ 
    url: url, 
    proxy: 'http://127.0.0.1:' + testProxyPort, 
    ca: fs.readFileSync(__dirname + '/../.http-mitm-proxy/certs/ca.pem'),
    agentOptions: {
      keepAlive: keepAlive
    }
  }, function (err, resp, body) {
	  cb(err, resp, body);
  });
};

var countString = function (str, substr, cb) {
  var pos = str.indexOf(substr);
  var len = substr.length;
  var count = 0;
  if (pos > -1) {
    var offSet = len;
    while(pos !== -1) {
      count++;
      offSet = pos + len;
      pos = str.indexOf(substr, offSet);
    }
  }
  cb(count);
};

describe('proxy', function () {
  this.timeout(30000);
  var srvA = null;
  var srvB = null;
  var proxy = null;
  var testHashes = {};
  var testFiles = [
    '1024.bin'
  ];
  var wss = null;

  before(function () {
    testFiles.forEach(function (val) {
      testHashes[val] = crypto.createHash('sha256').update(fs.readFileSync(__dirname + '/www/' + val, 'utf8'), 'utf8').digest().toString();
    });
    srvA = http.createServer(function (req, res) {
      req.addListener('end', function () {
        fileStaticA.serve(req, res);
      }).resume();
    });
    srvA.listen(testPortA, testHost);
    srvB = http.createServer(function (req, res) {
      req.addListener('end', function () {
        fileStaticB.serve(req, res);
      }).resume();
    });
    srvB.listen(testPortB, testHost);
    wss = new WebSocket.Server({
      port: testWSPort,
    });
    wss.on('connection', function (ws) {
      // just reply with the same message
      ws.on('message', function (message) {
        ws.send(message);
      });
    });
  });

  beforeEach(function (done) {
    proxy = new Proxy();
    proxy.listen({ port: testProxyPort }, done);
    proxy.onError(function (ctx, err, errorKind) {
      var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : '';
      console.log('proxy error: ' + errorKind + ' on ' + url + ':', err);
    });
  });

  afterEach(function () {
    proxy.close();
    proxy = null;
  });

  after(function () {
    srvA.close();
    srvA = null;
    srvB.close();
    srvB = null;
    wss.close();
    wss = null;
  });

  describe('ca server', function () {
    it('should generate a root CA file', function (done) {
      fs.access(__dirname + '/../.http-mitm-proxy/certs/ca.pem', function (err) {
        var rtv = null;
        if (err) {
          rtv = __dirname + '/../.http-mitm-proxy/certs/ca.pem ' + err;
        } else {
          rtv = true;
        }
        assert.equal(true, rtv, 'Can access the CA cert');
        done();
      });
    });
  });

  describe('http server', function () {
    describe('get a 1024 byte file', function () {
      it('a', function (done) {
        getHttp(testUrlA + '/1024.bin', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len, 'body length is 1024');
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString(), 'sha256 hash matches');
          done();
        });
      });
      it('b', function (done) {
        getHttp(testUrlB + '/1024.bin', function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len, 'body length is 1024');
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString(), 'sha256 hash matches');
          done();
        });
      });
    });
  });

  describe('proxy server', function () {
    this.timeout(5000);

    it('should handle socket errors in connect', function(done) {
      // If a socket disconnects during the CONNECT process, the resulting
      // error should be handled and shouldn't cause the proxy server to fail.
      const socket = net.createConnection(testProxyPort, testHost, function() {
        socket.write('CONNECT ' + testHost + ':' + testPortA + '\r\n\r\n');
        socket.destroy();
      });
      socket.on('close', function() {
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) {
            return done(new Error(err.message + " " + JSON.stringify(err)));
          }
          var len = 0;
          if (body.hasOwnProperty('length')) {
            len = body.length;
          }
          assert.equal(1024, len);
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      })
    });

    describe('proxy a 1024 byte file', function () {
      it('a', function (done) {
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
      it('b', function (done) {
        proxyHttp(testUrlB + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
    });
    describe('ssl', function () {
      it('proxys to google.com using local ca file', function (done) {
        proxyHttp('https://www.google.com/', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          assert.equal(200, resp.statusCode, '200 Status code from Google.');
          done();
        });
      }).timeout(15000);
    });

    describe('proxy a 1024 byte file with keepAlive', function () {
      it('a', function (done) {
        proxyHttp(testUrlA + '/1024.bin', true, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
      it('b', function (done) {
        proxyHttp(testUrlB + '/1024.bin', true, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(testHashes['1024.bin'], crypto.createHash('sha256').update(body, 'utf8').digest().toString());
          done();
        });
      });
    });
    describe('ssl with keepAlive', function () {
      it('proxys to google.com using local ca file', function (done) {
        proxyHttp('https://www.google.com/', true, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          assert.equal(200, resp.statusCode, '200 Status code from Google.');
          done();
        });
      }).timeout(15000);
    });

    describe('host match', function () {
      it('proxy and modify AAA 5 times if hostA', function (done) {
        proxy.onRequest(function (ctx, callback) {
          var testHostNameA = '127.0.0.1:' + testPortA;
          if (ctx.clientToProxyRequest.headers.host === testHostNameA) {
            var chunks = [];
            ctx.onResponseData(function (ctx, chunk, callback) {
              chunks.push(chunk);
              return callback(null, null);
            });
            ctx.onResponseEnd(function (ctx, callback) {
              var body = (Buffer.concat(chunks)).toString();
              for(var i = 0; i < 5; i++) {
                var off = (i * 10);
                body = body.substr(0, off) + 'AAA' + body.substr(off + 3);
              }
              ctx.proxyToClientResponse.write(body);
              return callback();
            });
          }
          return callback();
        });

        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          countString(body, 'AAA', function (count) {
            assert.equal(5, count);
            proxyHttp(testUrlB + '/1024.bin', false, function (errB, respB, bodyB) {
              if (errB) console.log('errB: ' + errB.toString());
              var lenB = 0;
              if (bodyB.hasOwnProperty('length')) lenB = bodyB.length;
              assert.equal(1024, lenB);
              countString(bodyB, 'AAA', function (countB) {
                assert.equal(0, countB);
                done();
              });
            });
          });
        });
      });
    });

    describe('chunked transfer', function () {
      it('should not change transfer encoding when no content modification is active', function (done) {
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal(null, resp.headers['transfer-encoding']);
          assert.equal(1024, resp.headers['content-length']);
          done();
        });
      });

      it('should use chunked transfer encoding when global onResponseData is active', function (done) {
        proxy.onResponseData(function (ctx, chunk, callback) {
          callback(null, chunk);
        });
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal('chunked', resp.headers['transfer-encoding']);
          assert.equal(null, resp.headers['content-length']);
          done();
        });
      });

      it('should use chunked transfer encoding when context onResponseData is active', function (done) {
        proxy.onResponse(function (ctx, callback) {
          ctx.onResponseData(function (ctx, chunk, callback) {
            callback(null, chunk);
          });
          callback(null);
        });
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(1024, len);
          assert.equal('chunked', resp.headers['transfer-encoding']);
          assert.equal(null, resp.headers['content-length']);
          done();
        });
      });

      it('should use chunked transfer encoding when context ResponseFilter is active', function (done) {
        proxy.onResponse(function (ctx, callback) {
          ctx.addResponseFilter(zlib.createGzip());
          callback(null);
        });
        proxyHttp(testUrlA + '/1024.bin', false, function (err, resp, body) {
          if (err) return done(new Error(err.message+" "+JSON.stringify(err)));
          var len = 0;
          if (body.hasOwnProperty('length')) len = body.length;
          assert.equal(true, len < 1024); // Compressed body
          assert.equal('chunked', resp.headers['transfer-encoding']);
          assert.equal(null, resp.headers['content-length']);
          done();
        });
      });
    });
  });

  describe('websocket server', function() {
    this.timeout(2000);

    it('send + receive message without proxy', function (done) {
      var ws = new WebSocket('ws://localhost:' + testWSPort);
      var testMessage = 'does the websocket server reply?';
      ws.on('open', function () {
        ws.on('message', function (data) {
          assert.equal(data, testMessage);
          ws.close();
          done();
        });
        ws.send(testMessage);
      });
    });

    it('send + receive message through proxy', function (done) {
      var ws = new WebSocket('ws://localhost:' + testProxyPort, {
        host: 'localhost:' + testWSPort,
      });
      var testMessage = 'does websocket proxying work?';
      ws.on('open', function () {
        ws.on('message', function (data) {
          assert.equal(data, testMessage);
          ws.close();
          done();
        });
        ws.send(testMessage);
      });
    });

    it('websocket callbacks get called', function (done) {
      var stats = {
        connection: false,
        frame: false,
        send: false,
        message: false,
        close: false,
      };

      proxy.onWebSocketConnection(function (ctx, callback) {
        stats.connection = true;
        return callback();
      });
      proxy.onWebSocketFrame(function(ctx, type, fromServer, message, flags, callback) {
        stats.frame = true;
        message = rewrittenMessage;
        return callback(null, message, flags);
      });
      proxy.onWebSocketSend(function(ctx, message, flags, callback) {
        stats.send = true;
        return callback(null, message, flags);
      });
      proxy.onWebSocketMessage(function(ctx, message, flags, callback) {
        stats.message = true;
        return callback(null, message, flags);
      });
      proxy.onWebSocketClose(function(ctx, code, message, callback) {
        stats.close = true;
        callback(null, code, message);
      });

      var ws = new WebSocket('ws://localhost:' + testProxyPort, {
        host: 'localhost:' + testWSPort,
      });
      var testMessage = 'does rewriting messages work?';
      var rewrittenMessage = 'rewriting messages does work!';
      ws.on('open', function () {
        ws.on('message', function (data) {
          assert.equal(data, rewrittenMessage);
          ws.close();
        });
        ws.on('close', function () {
          setTimeout(() => {
            assert(stats.connection);
            assert(stats.frame);
            assert(stats.send);
            assert(stats.message);
            if (!stats.close) {
              setTimeout(() => {
                assert(stats.close);
                done();
              }, 500);
            } else {
              done();
            }
          }, 0);
        });
        ws.send(testMessage);
      });
    });
  });
});
