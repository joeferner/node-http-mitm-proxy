const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});
proxy.onWebSocketConnection((ctx, callback) => {
  console.log("WEBSOCKET CONNECT:", ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});
proxy.onWebSocketFrame((ctx, type, fromServer, message, flags, callback) => {
  console.log(
    `WEBSOCKET FRAME ${type} received from ${fromServer ? "server" : "client"}`,
    ctx.clientToProxyWebSocket.upgradeReq.url,
    message
  );
  if (message) {
    const hackedMessage = message.replace(/Rock it/gi, "Hack it");
  }
  return callback(null, message, flags);
});
proxy.onWebSocketError((ctx, err) => {
  console.log(
    "WEBSOCKET ERROR ",
    ctx.clientToProxyWebSocket.upgradeReq.url,
    err
  );
});
proxy.onWebSocketClose((ctx, code, message, callback) => {
  console.log(
    `WEBSOCKET CLOSED BY ${ctx.closedByServer ? "SERVER" : "CLIENT"}`,
    ctx.clientToProxyWebSocket.upgradeReq.url,
    code,
    message
  );
  callback(null, code, message);
});

proxy.listen({ port });
console.log(`listening on ${port}`);
