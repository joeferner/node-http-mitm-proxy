'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err, errorKind) {
  // ctx may be null
  var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : '';
  console.error(errorKind + ' on ' + url + ':', err);
});
proxy.onWebSocketConnection(function(ctx, callback) {
  console.log('WEBSOCKET CONNECT:', ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});
proxy.onWebSocketFrame(function(ctx, type, fromServer, message, flags, callback) {
  console.log('WEBSOCKET FRAME ' + type + ' received from ' + (fromServer ? 'server' : 'client'), ctx.clientToProxyWebSocket.upgradeReq.url, message);
  if (message) var hackedMessage = message.replace(/Rock it/ig, 'Hack it');
  return callback(null, message, flags);
});
proxy.onWebSocketError(function(ctx, err) {
  console.log('WEBSOCKET ERROR ', ctx.clientToProxyWebSocket.upgradeReq.url, err);
});
proxy.onWebSocketClose(function(ctx, code, message, callback) {
  console.log('WEBSOCKET CLOSED BY '+(ctx.closedByServer ? 'SERVER' : 'CLIENT'), ctx.clientToProxyWebSocket.upgradeReq.url, code, message);
  callback(null, code, message);
});

proxy.listen({ port: port });
console.log('listening on ' + port);
