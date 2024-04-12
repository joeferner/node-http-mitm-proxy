const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});
proxy.onWebSocketConnection((ctx, callback) => {
  console.log("WEBSOCKET CONNECT:", ctx.clientToProxyWebSocket?.upgradeReq?.url);
  return callback();
});
proxy.onWebSocketSend((ctx, message, isBinary, callback) => {
  console.log(
    `WEBSOCKET Message received from client}`,
    ctx.clientToProxyWebSocket?.upgradeReq?.url,
    message
  );
  if (typeof message === 'string') {
    const hackedMessage = message.replace(/Rock it/gi, "Hack it");
    return callback(null, hackedMessage, false);
  }
  return callback(null, message, isBinary);
});
proxy.onWebSocketError((ctx, err) => {
  console.log(
    "WEBSOCKET ERROR ",
    ctx.clientToProxyWebSocket?.upgradeReq?.url,
    err
  );
});
proxy.onWebSocketClose((ctx, code, message, callback) => {
  console.log(
    `WEBSOCKET CLOSED BY ${ctx.closedByServer ? "SERVER" : "CLIENT"}`,
    ctx.clientToProxyWebSocket?.upgradeReq?.url,
    code,
    message
  );
  callback(null, code, message);
});

proxy.listen({ port });
console.log(`listening on ${port}`);
