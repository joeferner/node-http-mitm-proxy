'use strict';

var port = 8081;

var proxy = require('../')();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onRequest(function(ctx, callback) {
  console.log('REQUEST: http://' + ctx.clientToProxyRequest.headers.host + ctx.clientToProxyRequest.url);
  if (ctx.clientToProxyRequest.headers.host == 'www.google.com'
    && ctx.clientToProxyRequest.url.indexOf('/search') == 0) {
    ctx.onResponseData(function(ctx, chunk, callback) {
      console.log(chunk);
      return callback(null, chunk);
    });
  }
  return callback();
});

proxy.onRequestData(function(ctx, chunk, callback) {
  console.log('request data length: ' + chunk.length);
  return callback(null, chunk);
});

proxy.onResponse(function(ctx, callback) {
  console.log('RESPONSE: http://' + ctx.clientToProxyRequest.headers.host + ctx.clientToProxyRequest.url);
  return callback(null);
});

proxy.onResponseData(function(ctx, chunk, callback) {
  console.log('response data length: ' + chunk.length);
  return callback(null, chunk);
});

proxy.listen(port);
console.log('listening on ' + port);