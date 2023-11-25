import http = require("http");
import https = require("https");
import type CA from "../lib/ca";
import type WebSocket from "ws";
import type { Server } from "https";
import type { WebSocket as WebSocketType, WebSocketServer } from "ws";

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
  /** - The port or named socket for https server to listen on. (forceSNI must be enabled) */
  httpsPort?: number;
  /** - Setting this option will remove the content-length from the proxy to server request, forcing chunked encoding */
  forceChunkedRequest?: boolean;
}

export interface IProxySSLServer {
  port: number;
  server?: Server;
  wsServer?: WebSocketServer;
}
export type ICreateServerCallback = (
  port: number,
  server: Server,
  wssServer: WebSocketServer
) => void;
export type ErrorCallback = (error?: Error | null, data?: any) => void;
export type OnRequestParams = (ctx: IContext, callback: ErrorCallback) => void;
export type OnWebsocketRequestParams = (
  ctx: IWebSocketContext,
  callback: ErrorCallback
) => void;
export type IWebSocketCallback = (
  err: MaybeError,
  message?: any,
  flags?: any
) => void;
export type OnWebSocketSendParams = (
  ctx: IWebSocketContext,
  message: any,
  flags: any,
  callback: IWebSocketCallback
) => void;
export type OnWebSocketMessageParams = (
  ctx: IWebSocketContext,
  message: any,
  flags: any,
  callback: IWebSocketCallback
) => void;
export type OnWebSocketFrameParams = (
  ctx: IWebSocketContext,
  type: any,
  fromServer: boolean,
  message: any,
  flags: any,
  callback: IWebSocketCallback
) => void;
export type OnWebSocketErrorParams = (
  ctx: IWebSocketContext,
  err: MaybeError
) => void;
export type OnWebSocketCloseParams = (
  ctx: IWebSocketContext,
  code: any,
  message: any,
  callback: IWebSocketCallback
) => void;

export interface ICertDetails {
  keyFile: string;
  certFile: string;
  hosts?: string[];
}

export type MaybeError = Error | null | undefined;
export type OnCertificateMissingCallback = (
  error: MaybeError,
  certDetails: ICertDetails
) => void;
export type OnCertificateRequiredCallback = (
  error: MaybeError,
  certDetails: ICertDetails
) => void;
export type OnRequestDataCallback = (error?: MaybeError, chunk?: Buffer) => void;
export type OnRequestDataParams = (
  ctx: IContext,
  chunk: Buffer,
  callback: OnRequestDataCallback
) => void;
export type OnErrorParams = (
  context: IContext | null,
  err?: MaybeError,
  errorKind?: string
) => void;
export type OnConnectParams = (
  req: http.IncomingMessage,
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  socket: import("stream").Duplex,
  head: any,
  callback: ErrorCallback
) => void;
export type IProxy = ICallbacks & {
  /** Starts the proxy listening on the given port.  example: proxy.listen({ port: 80 }); */
  listen(options?: IProxyOptions, callback?: () => void): void;

  /** proxy.close
     Stops the proxy listening.

     Example

     proxy.close(); */
  close(): void;

  onCertificateRequired(
    hostname: string,
    callback: OnCertificateRequiredCallback
  ): void;
  onCertificateMissing(
    ctx: ICertficateContext,
    files: any,
    callback: OnCertificateMissingCallback
  ): void;

  onConnect(fcn: OnConnectParams): void;
  onWebSocketConnection(fcn: OnWebsocketRequestParams): void;
  onWebSocketSend(fcn: OnWebSocketSendParams): void;
  onWebSocketMessage(fcn: OnWebSocketMessageParams): void;
  onWebSocketFrame(fcn: OnWebSocketFrameParams): void;
  onWebSocketError(fcn: OnWebSocketErrorParams): void;
  onWebSocketClose(fcn: OnWebSocketCloseParams): void;

  options: IProxyOptions;
  httpPort: number;
  timeout: number;
  keepAlive: boolean;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  forceSNI: boolean;
  httpsPort?: number;
  sslCaDir: string;
  ca: CA;
};

/** signatures for various callback functions */
export interface ICallbacks {
  /**Adds a function to the list of functions to get called if an error occures.

     Arguments

     fn(ctx, err, errorKind) - The function to be called on an error.*/
  onError(callback: OnErrorParams): void;

  /** Adds a function to get called at the beginning of a request.

     Arguments

     fn(ctx, callback) - The function that gets called on each request.
     Example

     proxy.onRequest(function(ctx, callback) {
           console.log('REQUEST:', ctx.clientToProxyRequest.url);
           return callback();
         }); */
  onRequest(fcn: OnRequestParams): void;

  onRequestHeaders(fcn: OnRequestParams): void;
  onResponseHeaders(fcn: OnRequestParams): void;

  onRequestData(fcn: OnRequestDataParams): void;

  onRequestEnd(fcn: OnRequestParams): void;
  /** Adds a function to get called at the beginning of the response.

     Arguments

     fn(ctx, callback) - The function that gets called on each response.
     Example

     proxy.onResponse(function(ctx, callback) {
           console.log('BEGIN RESPONSE');
           return callback();
         }); */
  onResponse(fcn: OnRequestParams): void;

  onResponseData(fcn: OnRequestDataParams): void;

  onResponseEnd(fcn: OnRequestParams): void;

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

export interface IBaseContext {
  isSSL: boolean;
  uuid: string;

  /** may be set to true/false when dealing with websockets. */
  closedByServer?: boolean;
  closedByClient?: boolean;

  connectRequest: http.IncomingMessage;
  /** user defined tags, initially constructed in the proxy-internals.tx proxy.onRequest() callback, you can add what you like here. */
  tags?: {
    id: number;
    uri: string;
    /** ln 743 of proxy.js, hack to retry */
    failedUpstreamCalls: number;
    /** ln 743 of proxy.js, hack to retry */
    retryProxyRequest: boolean;
    [key: string]: any;
  };

  use(mod: any): void;
}

export type IContext = ICallbacks &
  IBaseContext & {
    clientToProxyRequest: http.IncomingMessage;
    proxyToClientResponse: http.ServerResponse;
    proxyToServerRequest: http.ClientRequest | undefined;
    serverToProxyResponse: http.IncomingMessage | undefined;

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
    proxyToServerRequestOptions:
    | undefined
    | {
      /** ex: "GET" */
      method: string;
      /** ex: "/success.txt" */
      path: string;

      /** example: "detectportal.firefox.com" */
      host: string;
      port: string | number | null | undefined;
      headers: { [key: string]: string };
      agent: http.Agent;
    };

    onRequestHandlers: OnRequestParams[];
    onResponseHandlers: OnRequestParams[];
    onErrorHandlers: OnErrorParams[];
    onRequestDataHandlers: OnRequestDataParams[];
    onResponseDataHandlers: OnRequestDataParams[];
    onRequestEndHandlers: OnRequestParams[];
    onResponseEndHandlers: OnRequestParams[];
    onRequestHeadersHandlers: OnRequestParams[];
    onResponseHeadersHandlers: OnRequestParams[];
    responseContentPotentiallyModified: boolean;
  };

export interface ICertficateContext {
  hostname: string;
  files: ICertDetails;
  data: { keyFileExists: boolean; certFileExists: boolean };
}

export type IWebSocketContext = IBaseContext & {
  /** instance of WebSocket object from https://github.com/websockets/ws */
  clientToProxyWebSocket?: WebSocketType;
  /** instance of WebSocket object from https://github.com/websockets/ws */
  proxyToServerWebSocket?: WebSocketType;

  proxyToServerWebSocketOptions?: WebSocket.ClientOptions & { url?: string };
  /** WebSocket Connection Hanlders */
  onWebSocketConnectionHandlers: OnWebsocketRequestParams[];
  onWebSocketFrameHandlers: OnWebSocketFrameParams[];
  onWebSocketCloseHandlers: OnWebSocketCloseParams[];
  onWebSocketErrorHandlers: OnWebSocketErrorParams[];

  onWebSocketConnection: (ws: OnWebsocketRequestParams) => void;
  onWebSocketSend: (ws: OnWebSocketSendParams) => void;
  onWebSocketMessage: (ws: OnWebSocketMessageParams) => void;
  onWebSocketFrame: (ws: OnWebSocketFrameParams) => void;
  onWebSocketClose: (ws: OnWebSocketCloseParams) => void;
  onWebSocketError: (ws: OnWebSocketErrorParams) => void;
};
