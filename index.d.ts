//definitions by jason swearingen.  jasons aat novaleaf doot coom.  for node-htt-mitm-proxy v0.5.2.  

 import http = require("http");
 import https = require("https");
 import net = require("net");


 declare namespace HttpMitmProxy {
     export interface IProxyStatic {
         (): IProxy;
         /** mod to pass to the use() function: Gunzip response filter (uncompress gzipped content before onResponseData and compress back after)*/
         gunzip: any;
         /** mod to pass to the use() function: Generates wilcard certificates by default (so less certificates are generated)*/
         wildcard: any;
     }

     export interface IProxyOptions {
         /**port - The port or named socket to listen on (default: 8080).*/
         port?: number;
         /**host - The hostname or local address to listen on.*/
         host?: string;
         /** - Path to the certificates cache directory (default: process.cwd() + '/.http-mitm-proxy')*/
         sslCaDir?: string;
         /**  - if set to true, nothing will be written to console (default: false) */
         silent?: boolean;
         /**  - enable HTTP persistent connection*/
         keepAlive?: boolean;
         /**  - The number of milliseconds of inactivity before a socket is presumed to have timed out. Defaults to no timeout. */
         timeout?: number;
         /**  - The http.Agent to use when making http requests. Useful for chaining proxys. (default: internal Agent) */
         httpAgent?: http.Agent;
         /** - The https.Agent to use when making https requests. Useful for chaining proxys. (default: internal Agent) */
         httpsAgent?: https.Agent;
         /** - force use of SNI by the client. Allow node-http-mitm-proxy to handle all HTTPS requests with a single internal server. */
         forceSNI?: boolean;
         /**  - The port or named socket for https server to listen on. (forceSNI must be enabled) */
         httpsPort?: number;
     }

     export type IProxy = ICallbacks & {
         /** Starts the proxy listening on the given port..  example: proxy.listen({ port: 80 }); */
         listen(/** An object with the following options: */ options?: IProxyOptions): void;
         /** proxy.close
         Stops the proxy listening.
        
         Example
        
         proxy.close(); */
         close(): void;


         onCertificateRequired(hostname: string, callback: (error: Error | undefined, certDetails: { keyFile: string; certFile: string; hosts: string[]; }) => void): void;
         onCertificateMissing(ctx: IContext, files: any, callback: (error: Error | undefined, certDetails: { keyFileData: string; certFileData: string; hosts: string[]; }) => void): void;

         //undocumented helpers
         onConnect(fcn: (req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void): void;
         onRequestHeaders(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;
         onResponseHeaders(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;
         onWebSocketConnection(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;
         onWebSocketSend(fcn: (ctx: IContext, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): void;
         onWebSocketMessage(fcn: (ctx: IContext, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): void;
         onWebSocketFrame(fcn: (ctx: IContext, type: any, fromServer: boolean, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): void;
         onWebSocketError(fcn: (ctx: IContext, err: Error | undefined) => void): void;
         onWebSocketClose(fcn: (ctx: IContext, code: any, message: any, callback: (err: Error | undefined, code: any, message: any) => void) => void): void;

         // onConnectHandlers:((req,socket,head,callback)=>void)[];
         // onRequestHandlers:((ctx,callback)=>void)[];

         options: IProxyOptions;
         silent: boolean;
         httpPort: number;
         timeout: number;
         keepAlive: boolean;
         httpAgent: http.Agent;
         httpsAgent: https.Agent;
         forceSNI: boolean;
         httpsPort?: number;
         sslCaDir: string;

     }

     /** signatures for various callback functions */
     export interface ICallbacks {
         onError(/**Adds a function to the list of functions to get called if an error occures.

 Arguments

 fn(ctx, err, errorKind) - The function to be called on an error.*/callback: (context: IContext, err?: Error, errorKind?: string) => void): void;

         /** Adds a function to get called at the beginning of a request.
        
         Arguments
        
         fn(ctx, callback) - The function that gets called on each request.
         Example
        
         proxy.onRequest(function(ctx, callback) {
           console.log('REQUEST:', ctx.clientToProxyRequest.url);
           return callback();
         }); */
         onRequest(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;

         onRequestData(fcn: (ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void): void;

         onRequestEnd(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;
         /** Adds a function to get called at the beginning of the response.
        
         Arguments
        
         fn(ctx, callback) - The function that gets called on each response.
         Example
        
         proxy.onResponse(function(ctx, callback) {
           console.log('BEGIN RESPONSE');
           return callback();
         }); */
         onResponse(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;

         onResponseData(fcn: (ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void): void;

         onResponseEnd(fcn: (ctx: IContext, callback: (error: Error | undefined) => void) => void): void;

         /** Adds a module into the proxy. Modules encapsulate multiple life cycle processing functions into one object.

             Arguments

             module - The module to add. Modules contain a hash of functions to add.
             Example

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
             node-http-mitm-proxy provide some ready to use modules:

             Proxy.gunzip Gunzip response filter (uncompress gzipped content before onResponseData and compress back after)
             Proxy.wildcard Generates wilcard certificates by default (so less certificates are generated) */
         use(mod: any): void;



     }


     export type IContext = ICallbacks & {
         isSSL: boolean;

         /** may be set to true/false when dealing with websockets. */
         closedByServer?: boolean;

         clientToProxyRequest: http.IncomingMessage;
         proxyToClientResponse: http.ServerResponse;
         proxyToServerRequest: http.ClientRequest;
         serverToProxyResponse: http.IncomingMessage;


         /** instance of WebSocket object from https://github.com/websockets/ws */
         clientToProxyWebSocket: any;
         /** instance of WebSocket object from https://github.com/websockets/ws */
         proxyToServerWebSocket: any;

         /** user defined tags, initially constructed in the proxy-internals.tx proxy.onRequest() callback, you can add what you like here. */
         tags: {
             id: number;
             uri:string;
             /** ln 743 of proxy.js, hack to retry */
             failedUpstreamCalls:number;
             /** ln 743 of proxy.js, hack to retry */
             retryProxyRequest:boolean;
             [key: string]: any;
         }

         /**Adds a stream into the request body stream.

 Arguments

 stream - The read/write stream to add in the request body stream.
 Example

 ctx.addRequestFilter(zlib.createGunzip()); */
         addRequestFilter(stream: any): void;
         /** Adds a stream into the response body stream.

 Arguments

 stream - The read/write stream to add in the response body stream.
 Example

 ctx.addResponseFilter(zlib.createGunzip()); */
         addResponseFilter(stream: any): void;

         /** filters added by .addRequestFilter() */
         requestFilters: any[];

         /** filters added by .addResponseFilter() */
         responseFilters: any[];

         /** undocumented, allows adjusting the request in callbacks (such as .onRequest()) before sending  upstream (to proxy or target host)..  
          * FYI these values seem pre-populated with defaults based on the request, you can modify them to change behavior. */
         proxyToServerRequestOptions: {
             /** ex: "GET" */
             method: string;
             /** ex: "/success.txt" */
             path: string;

             /** example: "detectportal.firefox.com" */
             host: string;
             port: null;
             headers: { [key: string]: string };
             agent: http.Agent;

         };

         onResponseDataHandlers:Function[];
         onResponseEndHandlers:Function[];



     }
 }

 declare const HttpMitmProxy: HttpMitmProxy.IProxyStatic
 export = HttpMitmProxy;
 export as namespace HttpMitmProxy;