'use strict';

var port = 8081;

var Proxy = require('../');
var proxy = Proxy();

proxy.onError(function(ctx, err, errorKind) {
  // ctx may be null
  var url = (ctx && ctx.clientToProxyRequest) ? ctx.clientToProxyRequest.url : "";
  console.error(errorKind + ' on ' + url + ':', err);
});
proxy.onWebSocketConnection(function(ctx, callback) {
  console.log('WEBSOCKET CONNECT:', ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});
proxy.onWebSocketSend(function(ctx, message, flags, callback) {
  console.log('WEBSOCKET SEND:', ctx.clientToProxyWebSocket.upgradeReq.url, message);
  var hackedMessage = message.replace(/Rock it/ig, "Hack it");
  return callback(null, hackedMessage, flags);
});
proxy.onWebSocketMessage(function(ctx, message, flags, callback) {
  console.log('WEBSOCKET MESSAGE ', ctx.clientToProxyWebSocket.upgradeReq.url, message);
  var hackedMessage = message.replace(/Rock it/ig, "Hack it");
  return callback(null, hackedMessage, flags);
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
