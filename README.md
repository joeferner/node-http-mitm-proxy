# HTTP MITM Proxy

HTTP Man In The Middle (MITM) Proxy written in node.js. Supports capturing and modifying the request and response data.

# Example

This example will modify any search results coming from google and replace all the result titles with "Pwned!".

```javascript
var Proxy = require('http-mitm-proxy');
var proxy = Proxy();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onRequest(function(ctx, callback) {
  if (ctx.clientToProxyRequest.headers.host == 'www.google.com'
    && ctx.clientToProxyRequest.url.indexOf('/search') == 0) {
    ctx.use(Proxy.gunzip);

    ctx.onResponseData(function(ctx, chunk, callback) {
      chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
      return callback(null, chunk);
    });
  }
  return callback();
});

proxy.listen({port: 8081});
```

You can find more examples in the (test directory)[tree/master/test]

# SSL

Using node-forge allows the automatic generation of SSL certificates within the proxy. After running your app you will find options.sslCaDir + '/certs/ca.pem' which can be imported to your browser, phone, etc.

# API

## Proxy
 * [listen(options)](#proxy_listen)
 * [onError(fn)](#proxy_onError)
 * [onCertificateRequired](#proxy_onCertificateRequired)
 * [onCertificateMissing](#proxy_onCertificateMissing)
 * [onRequest(fn)](#proxy_onRequest)
 * [onRequestData(fn)](#proxy_onRequestData)
 * [onResponse(fn)](#proxy_onResponse)
 * [onResponseData(fn)](#proxy_onResponseData)
 * [onWebSocketConnection(fn)](#proxy_onWebSocketConnection)
 * [onWebSocketSend(fn)](#proxy_onWebSocketSend)
 * [onWebSocketMessage(fn)](#proxy_onWebSocketMessage)
 * [onWebSocketError(fn)](#proxy_onWebSocketError)
 * [onWebSocketClose(fn)](#proxy_onWebSocketClose)
 * [use(fn)](#proxy_use)

## Context

 Context functions only effect the current request/response. For example you may only want to gunzip requests
 made to a particular host.

 * isSSL: boolean,
 * clientToProxyRequest: [IncomingMessage](https://nodejs.org/api/http.html#http_http_incomingmessage),
 * proxyToClientResponse: [ServerResponse](https://nodejs.org/api/http.html#http_class_http_serverresponse),
 * proxyToServerRequest: [ClientRequest](https://nodejs.org/api/http.html#http_class_http_clientrequest),
 * serverToProxyResponse: [ServerResponse](https://nodejs.org/api/http.html#http_class_http_serverresponse),
 * [onError(fn)](#proxy_onError)
 * [onRequest(fn)](#proxy_onRequest)
 * [onRequestData(fn)](#proxy_onRequestData)
 * [addRequestFilter(fn)](#context_addRequestFilter)
 * [onResponse(fn)](#proxy_onResponse)
 * [onResponseData(fn)](#proxy_onResponseData)
 * [onResponseEnd(fn)](#context_onResponseEnd)
 * [addResponseFilter(fn)](#context_addResponseFilter)
 * [use(mod)](#proxy_use)

## WebSocket Context

The context available in websocket handlers is a bit different

 * isSSL: boolean,
 * clientToProxyWebSocket: [WebSocket](https://github.com/websockets/ws/blob/master/doc/ws.md#class-wswebsocket),
 * proxyToServerWebSocket: [WebSocket](https://github.com/websockets/ws/blob/master/doc/ws.md#class-wswebsocket),
 * [onWebSocketConnection(fn)](#proxy_onWebSocketConnection)
 * [onWebSocketSend(fn)](#proxy_onWebSocketSend)
 * [onWebSocketMessage(fn)](#proxy_onWebSocketMessage)
 * [onWebSocketError(fn)](#proxy_onWebSocketError)
 * [onWebSocketClose(fn)](#proxy_onWebSocketClose)
 * [use(mod)](#proxy_use)

<a name="proxy"/>
## Proxy

<a name="proxy_listen" />
### proxy.listen

Starts the proxy listening on the given port.

__Arguments__

 * options - An object with the following options:
  * port - The port to listen on (default: 8080).
  * sslCaDir - Path to the certificates cache directory (default: process.cwd() + '/.http-mitm-proxy')

__Example__

    proxy.listen({ port: 80 });

<a name="proxy_onError" />
### proxy.onError(fn) or ctx.onError(fn)

Adds a function to the list of functions to get called if an error occures.

__Arguments__

 * fn(ctx, err) - The function to be called on an error.

__Example__

    proxy.onError(function(ctx, err) {
      console.error('error in proxy for url:', ctx.clientToProxyRequest.url, err);
    });

<a name="proxy_onCertificateRequired" />
### proxy.onCertificateRequired = function(hostname, callback)

Allows the default certificate name/path computation to be overwritten.

The default behavior expects `keys/{hostname}.pem` and `certs/{hostname}.pem` files to be at `self.sslCaDir`.

__Arguments__

 * hostname - Requested hostname.
 * callback - The function to be called when certificate files' path were already computed.

__Example__

    proxy.onCertificateRequired = function(hostname, callback) {
      return callback(null, {
        keyFile: path.resolve('/ca/certs/', hostname + '.key'),
        certFile: path.resolve('/ca/certs/', hostname + '.crt')
        });
    };

<a name="proxy_onCertificateMissing" />
### proxy.onCertificateMissing = function(ctx, files, callback)

Allows you to handle missing certificate files for current request, for example, creating them on the fly.

__Arguments__

* ctx - Context with the following properties
 * hostname - The hostname which requires certificates
 * data.keyFileExists - Whether key file exists or not
 * data.certFileExists - Whether certificate file exists or not
* files - missing files names (`files.keyFile` and `files.certFile`)
* callback - The function to be called to pass certificate data back (`keyFileData` and `certFileData`)

__Example__

    proxy.onCertificateMissing = function(ctx, files, callback) {
      console.log('Looking for "%s" certificates',   ctx.hostname);
      console.log('"%s" missing', ctx.files.keyFile);
      console.log('"%s" missing', ctx.files.certFile);

      // Here you have the last chance to provide certificate files data
      // A tipical use case would be creating them on the fly
      //
      // return callback(null, {
      //   keyFileData: keyFileData,
      //   certFileData: certFileData
      // });
      };

<a name="proxy_onRequest" />
### proxy.onRequest(fn) or ctx.onRequest(fn)

Adds a function to get called at the beginning of a request.

__Arguments__

 * fn(ctx, callback) - The function that gets called on each request.

__Example__

    proxy.onRequest(function(ctx, callback) {
      console.log('REQUEST:', ctx.clientToProxyRequest.url);
      return callback();
    });

<a name="proxy_onRequestData" />
### proxy.onRequestData(fn) or ctx.onRequestData(fn)

Adds a function to get called for each request data chunk (the body).

__Arguments__

 * fn(ctx, chunk, callback) - The function that gets called for each data chunk.

__Example__

    proxy.onRequestData(function(ctx, chunk, callback) {
      console.log('REQUEST DATA:', chunk.toString());
      return callback(null, chunk);
    });

<a name="proxy_onResponse" />
### proxy.onResponse(fn) or ctx.onResponse(fn)

Adds a function to get called at the beginning of the response.

__Arguments__

 * fn(ctx, callback) - The function that gets called on each response.

__Example__

    proxy.onResponse(function(ctx, callback) {
      console.log('BEGIN RESPONSE');
      return callback();
    });

<a name="proxy_onResponseData" />
### proxy.onResponseData(fn) or ctx.onResponseData(fn)

Adds a function to get called for each response data chunk (the body).

__Arguments__

 * fn(ctx, chunk, callback) - The function that gets called for each data chunk.

__Example__

    proxy.onResponseData(function(ctx, chunk, callback) {
      console.log('RESPONSE DATA:', chunk.toString());
      return callback(null, chunk);
    });

<a name="proxy_onWebSocketConnection" />
### proxy.onWebSocketConnection(fn) or ctx.onWebSocketConnection(fn)

Adds a function to get called at the beginning of websocket connection

__Arguments__

 * fn(ctx, callback) - The function that gets called for each data chunk.

__Example__

    proxy.onWebSocketConnection(function(ctx, callback) {
      console.log('WEBSOCKET CONNECT:', ctx.clientToProxyWebSocket.upgradeReq.url);
      return callback();
    });

<a name="proxy_onWebSocketSend" />
### proxy.onWebSocketSend(fn) or ctx.onWebSocketSend(fn)

Adds a function to get called for each WebSocket message sent by the client.

__Arguments__

 * fn(ctx, message, flags, callback) - The function that gets called  for each WebSocket message sent by the client.

__Example__

    proxy.onWebSocketSend(function(ctx, message, flags, callback) {
      console.log('WEBSOCKET SEND:', ctx.clientToProxyWebSocket.upgradeReq.url, message);
      return callback(null, message, flags);
    });

<a name="proxy_onWebSocketMessage" />
### proxy.onWebSocketMessage(fn) or ctx.onWebSocketMessage(fn)

Adds a function to get called for each WebSocket message received from the server.

__Arguments__

 * fn(ctx, message, flags, callback) - The function that gets called for each WebSocket message received from the server.

__Example__

    proxy.onWebSocketMessage(function(ctx, message, flags, callback) {
      console.log('WEBSOCKET MESSAGE:', ctx.clientToProxyWebSocket.upgradeReq.url, message);
      return callback(null, message, flags);
    });

<a name="proxy_onWebSocketError" />
### proxy.onWebSocketError(fn) or ctx.onWebSocketError(fn)

Adds a function to the list of functions to get called if an error occures in WebSocket.

__Arguments__

 * fn(ctx, err) - The function to be called on an error in WebSocket.

__Example__

    proxy.onWebSocketError(function(ctx, err) {
      console.log('WEBSOCKET ERROR:', ctx.clientToProxyWebSocket.upgradeReq.url, err);
    });
 
<a name="proxy_onWebSocketClose" />
### proxy.onWebSocketClose(fn) or ctx.onWebSocketClose(fn)

Adds a function to get called when a WebSocket connection is closed

__Arguments__

 * fn(ctx, code, message, callback) - The function that gets when a WebSocket is closed.

__Example__

    proxy.onWebSocketClose(function(ctx, code, message, callback) {
      console.log('WEBSOCKET CLOSED BY '+(ctx.closedByServer ? 'SERVER' : 'CLIENT'), ctx.clientToProxyWebSocket.upgradeReq.url, code, message);
      callback(null, code, message);
    });

<a name="proxy_use" />
### proxy.use(module) or ctx.use(module)

Adds a module into the proxy. Modules encapsulate multiple life cycle processing functions into one object.

__Arguments__

 * module - The module to add. Modules contain a hash of functions to add.

__Example__

    proxy.use({
      onError: function(ctx, err) { },
      onCertificateRequired: function(hostname, callback) { return callback(); },
      onCertificateMissing: function(ctx, files, callback) { return callback(); },
      onRequest: function(ctx, callback) { return callback(); },
      onRequestData: function(ctx, chunk, callback) { return callback(null, chunk); },
      onResponse: function(ctx, callback) { return callback(); },
      onResponseData: function(ctx, chunk, callback) { return callback(null, chunk); },
      onWebSocketConnection: function(ctx, callback) { return callback(); },
      onWebSocketSend: function(ctx, message, flags, callback) { return callback(null, message, flags); },
      onWebSocketMessage: function(ctx, message, flags, callback) { return callback(null, message, flags); },
      onWebSocketError: function(ctx, err) {  },
      onWebSocketClose: function(ctx, code, message, callback) {  },
    });

<a name="context"/>
## Context

<a name="context_addRequestFilter" />
### ctx.addRequestFilter(stream)

Adds a stream into the request body stream.

__Arguments__

 * stream - The read/write stream to add in the request body stream.

__Example__

    ctx.addRequestFilter(zlib.createGunzip());

<a name="context_addRequestFilter" />
### ctx.addResponseFilter(stream)

Adds a stream into the response body stream.

__Arguments__

 * stream - The read/write stream to add in the response body stream.

__Example__

    ctx.addResponseFilter(zlib.createGunzip());

<a name="context_onResponseEnd" />
### ctx.onResponseEnd(fn)

Adds a function to get called when the proxy request to server as ended.

__Arguments__

 * fn(ctx, callback) - The function that gets called when the proxy request to server as ended.

__Example__

    proxy.onResponseEnd(function(ctx, callback) {
      console.log('RESPONSE END', chunk.toString());
      return callback();
    });

# License

```
Copyright (c) 2015 Joe Ferner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:



The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.



THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
