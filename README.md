# HTTP MITM Proxy

This is the rewrite library from [node-http-mitm-proxy](https://github.com/joeferner/node-http-mitm-proxy)

We can get full request body before making any connection from the proxy server and the real server on this rewrite library

[![NPM version](http://img.shields.io/npm/v/http-mitm-proxy.svg)](https://www.npmjs.com/package/http-mitm-proxy)
[![](https://david-dm.org/joeferner/node-http-mitm-proxy.svg)](https://david-dm.org/joeferner/node-http-mitm-proxy)
[![Downloads](https://img.shields.io/npm/dm/http-mitm-proxy.svg)](https://www.npmjs.com/package/http-mitm-proxy)
![Test Status](https://github.com/joeferner/node-http-mitm-proxy/workflows/Tests/badge.svg)

# Install

`npm install --save http-mitm-proxy`

Using node-forge allows the automatic generation of SSL certificates within the proxy. After running your app you will find options.sslCaDir + '/certs/ca.pem' which can be imported to your browser, phone, etc.

# Example

```ts
proxy.onRequest(function (ctx, callbackOnRequest) {
  let requestBody: Buffer[] = [];

  proxy.onRequestData(function (ctx, chunk, callback) {
    requestBody.push(chunk);
    callback(null, chunk);
  });

  proxy.onRequestEnd(function (ctx, callback) {
    const rawBody = Buffer.concat(requestBodyBuffer);

    console.log("Request body before event onRequest has triggered: ", rawBody);

    callbackOnRequest();
  });
});
```
