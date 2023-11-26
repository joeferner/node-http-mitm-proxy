import async from "async";
import type { AddressInfo } from "net";
import net from "net";
import type {
  Server as HTTPServer,
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import http from "http";
import type { Server, ServerOptions } from "https";
import https from "https";
import fs from "fs";
import path from "path";
import type { WebSocket as WebSocketType } from "ws";
import WebSocket, { WebSocketServer } from "ws";

import url from "url";
import semaphore from "semaphore";
import ca from "./ca";
import { ProxyFinalResponseFilter } from "./ProxyFinalResponseFilter";
import { ProxyFinalRequestFilter } from "./ProxyFinalRequestFilter";
import { v4 as uuid } from "uuid";

import gunzip from "./middleware/gunzip";
import wildcard from "./middleware/wildcard";
import type {
  ICertDetails,
  IContext,
  IProxy,
  IProxyOptions,
  ErrorCallback,
  ICertficateContext,
  ICreateServerCallback,
  IProxySSLServer,
  IWebSocketContext,
  OnCertificateRequiredCallback,
  OnConnectParams,
  OnErrorParams,
  OnRequestDataParams,
  OnRequestParams,
  OnWebSocketCloseParams,
  OnWebSocketErrorParams,
  OnWebSocketFrameParams,
  OnWebSocketMessageParams,
  OnWebsocketRequestParams,
  OnWebSocketSendParams,
  IWebSocketCallback,
  OnRequestDataCallback,
} from "./types";
import type stream from "node:stream";
export { wildcard, gunzip };

type HandlerType<T extends (...args: any[]) => any> = Array<Parameters<T>[0]>;
interface WebSocketFlags {
  mask?: boolean | undefined;
  binary?: boolean | undefined;
  compress?: boolean | undefined;
  fin?: boolean | undefined;
}

export class Proxy implements IProxy {
  ca!: ca;
  connectRequests: Record<string, http.IncomingMessage> = {};
  forceSNI!: boolean;
  httpAgent!: http.Agent;
  httpHost?: string;
  httpPort!: number;
  httpServer: HTTPServer | undefined;
  httpsAgent!: https.Agent;
  httpsPort?: number;
  httpsServer: Server | undefined;
  keepAlive!: boolean;
  onConnectHandlers: HandlerType<IProxy["onConnect"]>;
  onErrorHandlers: HandlerType<IProxy["onError"]>;
  onRequestDataHandlers: HandlerType<IProxy["onRequestData"]>;
  onRequestEndHandlers: HandlerType<IProxy["onRequestEnd"]>;
  onRequestHandlers: HandlerType<IProxy["onRequest"]>;
  onRequestHeadersHandlers: HandlerType<IProxy["onRequestHeaders"]>;
  onResponseDataHandlers: HandlerType<IProxy["onResponseData"]>;
  onResponseEndHandlers: HandlerType<IProxy["onResponseEnd"]>;
  onResponseHandlers: HandlerType<IProxy["onResponse"]>;
  onResponseHeadersHandlers: HandlerType<IProxy["onResponseHeaders"]>;
  onWebSocketCloseHandlers: HandlerType<IProxy["onWebSocketClose"]>;
  onWebSocketConnectionHandlers: HandlerType<IProxy["onWebSocketConnection"]>;
  onWebSocketErrorHandlers: HandlerType<IProxy["onWebSocketError"]>;
  onWebSocketFrameHandlers: HandlerType<IProxy["onWebSocketFrame"]>;
  options!: IProxyOptions;
  responseContentPotentiallyModified: boolean;
  sslCaDir!: string;
  sslSemaphores: Record<string, semaphore.Semaphore> = {};
  sslServers: Record<string, IProxySSLServer> = {};
  timeout!: number;
  wsServer: WebSocketServer | undefined;
  wssServer: WebSocketServer | undefined;
  static wildcard = wildcard;
  static gunzip = gunzip;

  constructor() {
    this.onConnectHandlers = [];
    this.onRequestHandlers = [];
    this.onRequestHeadersHandlers = [];
    this.onWebSocketConnectionHandlers = [];
    this.onWebSocketFrameHandlers = [];
    this.onWebSocketCloseHandlers = [];
    this.onWebSocketErrorHandlers = [];
    this.onErrorHandlers = [];
    this.onRequestDataHandlers = [];
    this.onRequestEndHandlers = [];
    this.onResponseHandlers = [];
    this.onResponseHeadersHandlers = [];
    this.onResponseDataHandlers = [];
    this.onResponseEndHandlers = [];
    this.responseContentPotentiallyModified = false;
  }

  listen(options: IProxyOptions, callback: ErrorCallback = () => undefined) {
    const self = this;

    this.options = options || {};
    this.httpPort = options.port || options.port === 0 ? options.port : 8080;
    this.httpHost = options.host || "localhost";
    this.timeout = options.timeout || 0;
    this.keepAlive = !!options.keepAlive;
    this.httpAgent =
      typeof options.httpAgent !== "undefined"
        ? options.httpAgent
        : new http.Agent({ keepAlive: this.keepAlive });
    this.httpsAgent =
      typeof options.httpsAgent !== "undefined"
        ? options.httpsAgent
        : new https.Agent({ keepAlive: this.keepAlive });
    this.forceSNI = !!options.forceSNI;
    if (this.forceSNI) {
      console.info("SNI enabled. Clients not supporting SNI may fail");
    }
    this.httpsPort = this.forceSNI ? options.httpsPort : undefined;
    this.sslCaDir =
      options.sslCaDir || path.resolve(process.cwd(), ".http-mitm-proxy");
    ca.create(this.sslCaDir, (err, ca) => {
      if (err) {
        return callback(err);
      }
      self.ca = ca;
      self.sslServers = {};
      self.sslSemaphores = {};
      self.connectRequests = {};
      self.httpServer = http.createServer();
      self.httpServer!.timeout = self.timeout;
      self.httpServer!.on("connect", self._onHttpServerConnect.bind(self));
      self.httpServer!.on(
        "request",
        self._onHttpServerRequest.bind(self, false)
      );
      self.wsServer = new WebSocketServer({ server: self.httpServer });
      self.wsServer.on(
        "error",
        self._onError.bind(self, "HTTP_SERVER_ERROR", null)
      );
      self.wsServer.on("connection", (ws, req) => {
        ws.upgradeReq = req;
        self._onWebSocketServerConnect.call(self, false, ws, req);
      });
      const listenOptions = {
        host: self.httpHost,
        port: self.httpPort,
      };
      if (self.forceSNI) {
        // start the single HTTPS server now
        self._createHttpsServer({}, (port, httpsServer, wssServer) => {
          console.debug(`https server started on ${port}`);
          self.httpsServer = httpsServer;
          self.wssServer = wssServer;
          self.httpsPort = port;
          self.httpServer!.listen(listenOptions, () => {
            self.httpPort = (self.httpServer!.address() as AddressInfo).port;
            callback();
          });
        });
      } else {
        self.httpServer.listen(listenOptions, () => {
          self.httpPort = (self.httpServer!.address() as AddressInfo).port;
          callback();
        });
      }
    });
    return this;
  }

  _createHttpsServer(
    options: ServerOptions & { hosts?: string[] },
    callback: ICreateServerCallback
  ) {
    const httpsServer = https.createServer({
      ...options,
    } as ServerOptions);
    httpsServer.timeout = this.timeout;
    httpsServer.on(
      "error",
      this._onError.bind(this, "HTTPS_SERVER_ERROR", null)
    );
    httpsServer.on(
      "clientError",
      this._onError.bind(this, "HTTPS_CLIENT_ERROR", null)
    );
    httpsServer.on("connect", this._onHttpServerConnect.bind(this));
    httpsServer.on("request", this._onHttpServerRequest.bind(this, true));
    const self = this;
    const wssServer = new WebSocketServer({ server: httpsServer });
    wssServer.on("connection", (ws, req) => {
      ws.upgradeReq = req;
      self._onWebSocketServerConnect.call(self, true, ws, req);
    });

    // Using listenOptions to bind the server to a particular IP if requested via options.host
    // port 0 to get the first available port
    const listenOptions = {
      port: 0,
      host: "0.0.0.0",
    };
    if (this.httpsPort && !options.hosts) {
      listenOptions.port = this.httpsPort;
    }
    if (this.httpHost) {
      listenOptions.host = this.httpHost;
    }

    httpsServer.listen(listenOptions, () => {
      if (callback) {
        callback(
          (httpsServer.address() as AddressInfo).port,
          httpsServer,
          wssServer
        );
      }
    });
  }

  close() {
    this.httpServer!.close();
    delete this.httpServer;
    if (this.httpsServer) {
      this.httpsServer.close();
      delete this.httpsServer;
      delete this.wssServer;
      this.sslServers = {};
    }
    if (this.sslServers) {
      for (const srvName of Object.keys(this.sslServers)) {
        const server = this.sslServers[srvName].server;
        if (server) {
          server.close();
        }
        delete this.sslServers[srvName];
      }
    }
    return this;
  }

  onError(fn: OnErrorParams) {
    this.onErrorHandlers.push(fn);
    return this;
  }

  onConnect(fn: OnConnectParams) {
    this.onConnectHandlers.push(fn);
    return this;
  }

  onRequestHeaders(fn: OnRequestParams) {
    this.onRequestHeadersHandlers.push(fn);
    return this;
  }

  onRequest(fn: OnRequestParams) {
    this.onRequestHandlers.push(fn);
    return this;
  }

  onWebSocketConnection(fn: OnWebsocketRequestParams) {
    this.onWebSocketConnectionHandlers.push(fn);
    return this;
  }

  onWebSocketSend(fn: OnWebSocketSendParams) {
    this.onWebSocketFrameHandlers.push(
      function (ctx, type, fromServer, data, flags, callback) {
        if (!fromServer && type === "message") {
          return this(ctx, data, flags, callback);
        } else {
          callback(null, data, flags);
        }
      }.bind(fn)
    );
    return this;
  }

  onWebSocketMessage(fn: OnWebSocketMessageParams) {
    this.onWebSocketFrameHandlers.push(
      function (ctx, type, fromServer, data, flags, callback) {
        if (fromServer && type === "message") {
          return this(ctx, data, flags, callback);
        } else {
          callback(null, data, flags);
        }
      }.bind(fn)
    );
    return this;
  }

  onWebSocketFrame(fn: OnWebSocketFrameParams) {
    this.onWebSocketFrameHandlers.push(fn);
    return this;
  }

  onWebSocketClose(fn: OnWebSocketCloseParams) {
    this.onWebSocketCloseHandlers.push(fn);
    return this;
  }

  onWebSocketError(fn: OnWebSocketErrorParams) {
    this.onWebSocketErrorHandlers.push(fn);
    return this;
  }

  onRequestData(fn: OnRequestDataParams) {
    this.onRequestDataHandlers.push(fn);
    return this;
  }

  onRequestEnd(fn: OnRequestParams) {
    this.onRequestEndHandlers.push(fn);
    return this;
  }

  onResponse(fn: OnRequestParams) {
    this.onResponseHandlers.push(fn);
    return this;
  }

  onResponseHeaders(fn: OnRequestParams) {
    this.onResponseHeadersHandlers.push(fn);
    return this;
  }

  onResponseData(fn: OnRequestDataParams) {
    this.onResponseDataHandlers.push(fn);
    this.responseContentPotentiallyModified = true;
    return this;
  }

  onResponseEnd(fn: OnRequestParams) {
    this.onResponseEndHandlers.push(fn);
    return this;
  }

  use(mod) {
    if (mod.onError) {
      this.onError(mod.onError);
    }
    if (mod.onCertificateRequired) {
      this.onCertificateRequired = mod.onCertificateRequired;
    }
    if (mod.onCertificateMissing) {
      this.onCertificateMissing = mod.onCertificateMissing;
    }
    if (mod.onConnect) {
      this.onConnect(mod.onConnect);
    }
    if (mod.onRequest) {
      this.onRequest(mod.onRequest);
    }
    if (mod.onRequestHeaders) {
      this.onRequestHeaders(mod.onRequestHeaders);
    }
    if (mod.onRequestData) {
      this.onRequestData(mod.onRequestData);
    }
    if (mod.onResponse) {
      this.onResponse(mod.onResponse);
    }
    if (mod.onResponseHeaders) {
      this.onResponseHeaders(mod.onResponseHeaders);
    }
    if (mod.onResponseData) {
      this.onResponseData(mod.onResponseData);
    }
    if (mod.onWebSocketConnection) {
      this.onWebSocketConnection(mod.onWebSocketConnection);
    }
    if (mod.onWebSocketSend) {
      this.onWebSocketFrame(
        function (ctx, type, fromServer, data, flags, callback) {
          if (!fromServer && type === "message") {
            return this(ctx, data, flags, callback);
          } else {
            callback(null, data, flags);
          }
        }.bind(mod.onWebSocketSend)
      );
    }
    if (mod.onWebSocketMessage) {
      this.onWebSocketFrame(
        function (ctx, type, fromServer, data, flags, callback) {
          if (fromServer && type === "message") {
            return this(ctx, data, flags, callback);
          } else {
            callback(null, data, flags);
          }
        }.bind(mod.onWebSocketMessage)
      );
    }
    if (mod.onWebSocketFrame) {
      this.onWebSocketFrame(mod.onWebSocketFrame);
    }
    if (mod.onWebSocketClose) {
      this.onWebSocketClose(mod.onWebSocketClose);
    }
    if (mod.onWebSocketError) {
      this.onWebSocketError(mod.onWebSocketError);
    }
    return this;
  }

  // Since node 0.9.9, ECONNRESET on sockets are no longer hidden
  _onSocketError(socketDescription: string, err: NodeJS.ErrnoException) {
    if (err.errno === -54 || err.code === "ECONNRESET") {
      console.debug(`Got ECONNRESET on ${socketDescription}, ignoring.`);
    } else {
      this._onError(`${socketDescription}_ERROR`, null, err);
    }
  }

  _onHttpServerConnect(
    req: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer
  ) {
    const self = this;

    socket.on(
      "error",
      self._onSocketError.bind(self, "CLIENT_TO_PROXY_SOCKET")
    );

    // you can forward HTTPS request directly by adding custom CONNECT method handler
    return async.forEach(
      self.onConnectHandlers,
      (fn, callback) => fn.call(self, req, socket, head, callback),
      (err) => {
        if (err) {
          return self._onError("ON_CONNECT_ERROR", null, err);
        }
        // we need first byte of data to detect if request is SSL encrypted

        if (!head || head.length === 0) {
          socket.once(
            "data",
            self._onHttpServerConnectData.bind(self, req, socket)
          );
          socket.write("HTTP/1.1 200 OK\r\n");
          if (
            self.keepAlive &&
            req.headers["proxy-connection"] === "keep-alive"
          ) {
            socket.write("Proxy-Connection: keep-alive\r\n");
            socket.write("Connection: keep-alive\r\n");
          }
          return socket.write("\r\n");
        } else {
          self._onHttpServerConnectData(req, socket, head);
        }
      }
    );
  }

  _onHttpServerConnectData(
    req: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer
  ) {
    const self = this;

    socket.pause();
    function makeConnection(port: number) {
      // open a TCP connection to the remote host
      const conn = net.connect(
        {
          port,
          host: "0.0.0.0",
          allowHalfOpen: true,
        },

        () => {
          // create a tunnel between the two hosts
          const connectKey = `${conn.localPort}:${conn.remotePort}`;
          self.connectRequests[connectKey] = req;
          const cleanupFunction = () => {
            delete self.connectRequests[connectKey];
          };
          conn.on("close", () => {
            cleanupFunction();
            socket.destroy();
          });
          socket.on("close", () => {
            conn.destroy();
          });
          conn.on("error", (err) => {
            console.error("Connection error:");
            console.error(err);
            conn.destroy();
          });
          socket.on("error", (err) => {
            console.error("Socket error:");
            console.error(err);
          });
          socket.pipe(conn);
          conn.pipe(socket);
          socket.emit("data", head);
          return socket.resume();
        }
      );
      conn.on("error", self._onSocketError.bind(self, "PROXY_TO_PROXY_SOCKET"));
    }

    function getHttpsServer(hostname: string, callback: ErrorCallback) {
      self.onCertificateRequired(hostname, (err, files) => {
        if (err) {
          return callback(err);
        }
        const httpsOptions = [
          "keyFileExists",
          "certFileExists",
          (data: ICertficateContext["data"], callback) => {
            if (data.keyFileExists && data.certFileExists) {
              return fs.readFile(files.keyFile, (err, keyFileData) => {
                if (err) {
                  return callback(err);
                }

                return fs.readFile(files.certFile, (err, certFileData) => {
                  if (err) {
                    return callback(err);
                  }

                  return callback(null, {
                    key: keyFileData,
                    cert: certFileData,
                    hosts: files.hosts,
                  });
                });
              });
            } else {
              const ctx: ICertficateContext = {
                hostname,
                files,
                data,
              };

              return self.onCertificateMissing(ctx, files, (err, files) => {
                if (err) {
                  return callback(err);
                }

                return callback(null, {
                  key: files.keyFileData,
                  cert: files.certFileData,
                  hosts: files.hosts,
                });
              });
            }
          },
        ];
        async.auto(
          {
            keyFileExists(callback) {
              return fs.exists(files.keyFile, (exists) =>
                callback(null, exists)
              );
            },
            certFileExists(callback) {
              return fs.exists(files.certFile, (exists) =>
                callback(null, exists)
              );
            },
            // @ts-ignore
            httpsOptions,
          },
          (err, results) => {
            if (err) {
              return callback(err);
            }
            let hosts;
            if (
              results.httpsOptions &&
              results.httpsOptions.hosts &&
              results.httpsOptions.hosts.length
            ) {
              hosts = results.httpsOptions.hosts;
              if (!hosts.includes(hostname)) {
                hosts.push(hostname);
              }
            } else {
              hosts = [hostname];
            }
            delete results.httpsOptions.hosts;
            if (self.forceSNI && !hostname.match(/^[\d.]+$/)) {
              console.debug(`creating SNI context for ${hostname}`);
              hosts.forEach((host) => {
                self.httpsServer!.addContext(host, results.httpsOptions);
                self.sslServers[host] = { port: Number(self.httpsPort) };
              });
              return callback(null, self.httpsPort);
            } else {
              console.debug(`starting server for ${hostname}`);
              results.httpsOptions.hosts = hosts;
              try {
                self._createHttpsServer(
                  results.httpsOptions,
                  (port, httpsServer, wssServer) => {
                    console.debug(
                      `https server started for ${hostname} on ${port}`
                    );
                    const sslServer = {
                      server: httpsServer,
                      wsServer: wssServer,
                      port,
                    };
                    hosts.forEach((host) => {
                      self.sslServers[host] = sslServer;
                    });
                    return callback(null, port);
                  }
                );
              } catch (err: any) {
                return callback(err);
              }
            }
          }
        );
      });
    }
    /*
     * Detect TLS from first bytes of data
     * Inspired from https://gist.github.com/tg-x/835636
     * used heuristic:
     * - an incoming connection using SSLv3/TLSv1 records should start with 0x16
     * - an incoming connection using SSLv2 records should start with the record size
     *   and as the first record should not be very big we can expect 0x80 or 0x00 (the MSB is a flag)
     * - everything else is considered to be unencrypted
     */
    if (head[0] == 0x16 || head[0] == 0x80 || head[0] == 0x00) {
      // URL is in the form 'hostname:port'
      const hostname = req.url!.split(":", 2)[0];
      const sslServer = this.sslServers[hostname];
      if (sslServer) {
        return makeConnection(sslServer.port);
      }
      const wildcardHost = hostname.replace(/[^.]+\./, "*.");
      let sem = self.sslSemaphores[wildcardHost];
      if (!sem) {
        sem = self.sslSemaphores[wildcardHost] = semaphore(1);
      }
      sem.take(() => {
        if (self.sslServers[hostname]) {
          process.nextTick(sem.leave.bind(sem));
          return makeConnection(self.sslServers[hostname].port);
        }
        if (self.sslServers[wildcardHost]) {
          process.nextTick(sem.leave.bind(sem));
          self.sslServers[hostname] = {
            // @ts-ignore
            port: self.sslServers[wildcardHost].port,
          };
          return makeConnection(self.sslServers[hostname].port);
        }
        getHttpsServer(hostname, (err, port) => {
          process.nextTick(sem.leave.bind(sem));
          if (err) {
            console.error("Error getting HTTPs server");
            console.error(err);
            return self._onError("OPEN_HTTPS_SERVER_ERROR", null, err);
          }
          return makeConnection(port);
        });
        delete self.sslSemaphores[wildcardHost];
      });
    } else {
      return makeConnection(this.httpPort);
    }
  }

  onCertificateRequired(
    hostname: string,
    callback: OnCertificateRequiredCallback
  ) {
    const self = this;
    return callback(null, {
      keyFile: `${self.sslCaDir}/keys/${hostname}.key`,
      certFile: `${self.sslCaDir}/certs/${hostname}.pem`,
      hosts: [hostname],
    });
  }

  onCertificateMissing(
    ctx: ICertficateContext,
    files: ICertDetails,
    callback: ErrorCallback
  ) {
    const hosts = files.hosts || [ctx.hostname];
    this.ca.generateServerCertificateKeys(hosts, (certPEM, privateKeyPEM) => {
      callback(null, {
        certFileData: certPEM,
        keyFileData: privateKeyPEM,
        hosts,
      });
    });
  }

  _onError(kind: string, ctx: IContext | null, err: Error) {
    console.error(kind);
    console.error(err);

    this.onErrorHandlers.forEach((handler) => handler(ctx, err, kind));
    if (ctx) {
      ctx.onErrorHandlers.forEach((handler) => handler(ctx, err, kind));

      if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
        ctx.proxyToClientResponse.writeHead(504, "Proxy Error");
      }
      if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
        ctx.proxyToClientResponse.end(`${kind}: ${err}`, "utf8");
      }
    }
  }

  _onWebSocketServerConnect(
    isSSL: boolean,
    ws: WebSocketType,
    upgradeReq: IncomingMessage
  ) {
    const self = this;
    // @ts-ignore
    const socket = ws._socket;
    const ctx: IWebSocketContext = {
      uuid: uuid(),
      proxyToServerWebSocketOptions: undefined,
      proxyToServerWebSocket: undefined,
      isSSL,
      connectRequest:
        self.connectRequests[`${socket.remotePort}:${socket.localPort}`],
      clientToProxyWebSocket: ws,
      onWebSocketConnectionHandlers: [],
      onWebSocketFrameHandlers: [],
      onWebSocketCloseHandlers: [],
      onWebSocketErrorHandlers: [],
      onWebSocketConnection(fn) {
        ctx.onWebSocketConnectionHandlers.push(fn);
        return ctx;
      },
      onWebSocketSend(fn) {
        ctx.onWebSocketFrameHandlers.push(
          function (ctx, type, fromServer, data, flags, callback) {
            if (!fromServer && type === "message") {
              return this(ctx, data, flags, callback);
            } else {
              callback(null, data, flags);
            }
          }.bind(fn)
        );
        return ctx;
      },
      onWebSocketMessage(fn) {
        ctx.onWebSocketFrameHandlers.push(
          function (ctx, type, fromServer, data, flags, callback) {
            if (fromServer && type === "message") {
              return this(ctx, data, flags, callback);
            } else {
              callback(null, data, flags);
            }
          }.bind(fn)
        );
        return ctx;
      },
      onWebSocketFrame(fn) {
        ctx.onWebSocketFrameHandlers.push(fn);
        return ctx;
      },
      onWebSocketClose(fn) {
        ctx.onWebSocketCloseHandlers.push(fn);
        return ctx;
      },
      onWebSocketError(fn) {
        ctx.onWebSocketErrorHandlers.push(fn);
        return ctx;
      },
      use(mod) {
        if (mod.onWebSocketConnection) {
          ctx.onWebSocketConnection(mod.onWebSocketConnection);
        }
        if (mod.onWebSocketSend) {
          ctx.onWebSocketFrame(
            function (ctx, type, fromServer, data, flags, callback) {
              if (!fromServer && type === "message") {
                return this(ctx, data, flags, callback);
              } else {
                callback(null, data, flags);
              }
            }.bind(mod.onWebSocketSend)
          );
        }
        if (mod.onWebSocketMessage) {
          ctx.onWebSocketFrame(
            function (ctx, type, fromServer, data, flags, callback) {
              if (fromServer && type === "message") {
                return this(ctx, data, flags, callback);
              } else {
                callback(null, data, flags);
              }
            }.bind(mod.onWebSocketMessage)
          );
        }
        if (mod.onWebSocketFrame) {
          ctx.onWebSocketFrame(mod.onWebSocketFrame);
        }
        if (mod.onWebSocketClose) {
          ctx.onWebSocketClose(mod.onWebSocketClose);
        }
        if (mod.onWebSocketError) {
          ctx.onWebSocketError(mod.onWebSocketError);
        }
        return ctx;
      },
    };
    const clientToProxyWebSocket = ctx.clientToProxyWebSocket!;
    clientToProxyWebSocket.on(
      "message",
      self._onWebSocketFrame.bind(self, ctx, "message", false)
    );
    clientToProxyWebSocket.on(
      "ping",
      self._onWebSocketFrame.bind(self, ctx, "ping", false)
    );
    clientToProxyWebSocket.on(
      "pong",
      self._onWebSocketFrame.bind(self, ctx, "pong", false)
    );
    clientToProxyWebSocket.on("error", self._onWebSocketError.bind(self, ctx));
    // @ts-ignore
    clientToProxyWebSocket._socket.on(
      "error",
      self._onWebSocketError.bind(self, ctx)
    );
    clientToProxyWebSocket.on(
      "close",
      self._onWebSocketClose.bind(self, ctx, false)
    );
    // @ts-ignore
    clientToProxyWebSocket._socket.pause();

    let url;
    if (upgradeReq.url == "" || /^\//.test(upgradeReq.url!)) {
      const hostPort = Proxy.parseHostAndPort(upgradeReq);

      const prefix = ctx.isSSL ? "wss" : "ws";
      const port = hostPort!.port ? ":" + hostPort!.port : "";
      url = `${prefix}://${hostPort!.host}${port}${upgradeReq.url}`;
    } else {
      url = upgradeReq.url;
    }
    const ptosHeaders = {};
    const ctopHeaders = upgradeReq.headers;
    for (const key in ctopHeaders) {
      if (key.indexOf("sec-websocket") !== 0) {
        ptosHeaders[key] = ctopHeaders[key];
      }
    }
    ctx.proxyToServerWebSocketOptions = {
      url,
      agent: ctx.isSSL ? self.httpsAgent : self.httpAgent,
      headers: ptosHeaders,
    };
    function makeProxyToServerWebSocket() {
      ctx.proxyToServerWebSocket = new WebSocket(
        ctx.proxyToServerWebSocketOptions!.url!,
        ctx.proxyToServerWebSocketOptions
      );
      ctx.proxyToServerWebSocket.on(
        "message",
        self._onWebSocketFrame.bind(self, ctx, "message", true)
      );
      ctx.proxyToServerWebSocket.on(
        "ping",
        self._onWebSocketFrame.bind(self, ctx, "ping", true)
      );
      ctx.proxyToServerWebSocket.on(
        "pong",
        self._onWebSocketFrame.bind(self, ctx, "pong", true)
      );
      ctx.proxyToServerWebSocket.on(
        "error",
        self._onWebSocketError.bind(self, ctx)
      );
      ctx.proxyToServerWebSocket.on(
        "close",
        self._onWebSocketClose.bind(self, ctx, true)
      );
      ctx.proxyToServerWebSocket.on("open", () => {
        // @ts-ignore
        ctx.proxyToServerWebSocket._socket.on(
          "error",
          self._onWebSocketError.bind(self, ctx)
        );
        if (clientToProxyWebSocket!.readyState === WebSocket.OPEN) {
          // @ts-ignore
          clientToProxyWebSocket._socket.resume();
        }
      });
    }

    return self._onWebSocketConnection(ctx, (err) => {
      if (err) {
        return self._onWebSocketError(ctx, err);
      }
      return makeProxyToServerWebSocket();
    });
  }

  _onHttpServerRequest(
    isSSL: boolean,
    clientToProxyRequest: IncomingMessage,
    proxyToClientResponse: ServerResponse
  ) {
    const self = this;
    const ctx: IContext = {
      uuid: uuid(),
      isSSL,
      serverToProxyResponse: undefined,
      proxyToServerRequestOptions: undefined,
      proxyToServerRequest: undefined,
      connectRequest:
        self.connectRequests[
          `${clientToProxyRequest.socket.remotePort}:${clientToProxyRequest.socket.localPort}`
        ] || undefined,
      clientToProxyRequest,
      proxyToClientResponse,
      onRequestHandlers: [],
      onErrorHandlers: [],
      onRequestDataHandlers: [],
      onResponseHeadersHandlers: [],
      onRequestHeadersHandlers: [],
      onRequestEndHandlers: [],
      onResponseHandlers: [],
      onResponseDataHandlers: [],
      onResponseEndHandlers: [],
      requestFilters: [],
      responseFilters: [],
      responseContentPotentiallyModified: false,
      onRequest(fn) {
        ctx.onRequestHandlers.push(fn);
        return ctx;
      },
      onError(fn) {
        ctx.onErrorHandlers.push(fn);
        return ctx;
      },
      onRequestData(fn) {
        ctx.onRequestDataHandlers.push(fn);
        return ctx;
      },
      onRequestHeaders(fn) {
        ctx.onRequestHeadersHandlers.push(fn);
        return ctx;
      },
      onResponseHeaders(fn) {
        ctx.onResponseHeadersHandlers.push(fn);
        return ctx;
      },
      onRequestEnd(fn) {
        ctx.onRequestEndHandlers.push(fn);
        return ctx;
      },
      addRequestFilter(filter) {
        ctx.requestFilters.push(filter);
        return ctx;
      },
      onResponse(fn) {
        ctx.onResponseHandlers.push(fn);
        return ctx;
      },
      onResponseData(fn) {
        ctx.onResponseDataHandlers.push(fn);
        ctx.responseContentPotentiallyModified = true;
        return ctx;
      },
      onResponseEnd(fn) {
        ctx.onResponseEndHandlers.push(fn);
        return ctx;
      },
      addResponseFilter(filter) {
        ctx.responseFilters.push(filter);
        ctx.responseContentPotentiallyModified = true;
        return ctx;
      },
      use(mod) {
        if (mod.onError) {
          ctx.onError(mod.onError);
        }
        if (mod.onRequest) {
          ctx.onRequest(mod.onRequest);
        }
        if (mod.onRequestHeaders) {
          ctx.onRequestHeaders(mod.onRequestHeaders);
        }
        if (mod.onRequestData) {
          ctx.onRequestData(mod.onRequestData);
        }
        if (mod.onResponse) {
          ctx.onResponse(mod.onResponse);
        }
        if (mod.onResponseData) {
          ctx.onResponseData(mod.onResponseData);
        }
        return ctx;
      },
    };

    ctx.clientToProxyRequest.on(
      "error",
      self._onError.bind(self, "CLIENT_TO_PROXY_REQUEST_ERROR", ctx)
    );
    ctx.proxyToClientResponse.on(
      "error",
      self._onError.bind(self, "PROXY_TO_CLIENT_RESPONSE_ERROR", ctx)
    );
    ctx.clientToProxyRequest.pause();
    const hostPort = Proxy.parseHostAndPort(
      ctx.clientToProxyRequest,
      ctx.isSSL ? 443 : 80
    );
    function proxyToServerRequestComplete(
      serverToProxyResponse: http.IncomingMessage
    ) {
      serverToProxyResponse.on(
        "error",
        self._onError.bind(self, "SERVER_TO_PROXY_RESPONSE_ERROR", ctx)
      );
      serverToProxyResponse.pause();
      ctx.serverToProxyResponse = serverToProxyResponse;
      return self._onResponse(ctx, (err) => {
        if (err) {
          return self._onError("ON_RESPONSE_ERROR", ctx, err);
        }
        const servToProxyResp = ctx.serverToProxyResponse!;
        if(servToProxyResp.headers["trailer"]){
          servToProxyResp.headers["transfer-encoding"] = "chunked";
        }
        if (
          self.responseContentPotentiallyModified ||
          ctx.responseContentPotentiallyModified
        ) {
          servToProxyResp.headers["transfer-encoding"] = "chunked";
          delete servToProxyResp.headers["content-length"];
        }
        if (self.keepAlive) {
          if (ctx.clientToProxyRequest.headers["proxy-connection"]) {
            servToProxyResp.headers["proxy-connection"] = "keep-alive";
            servToProxyResp.headers["connection"] = "keep-alive";
          }
        } else {
          servToProxyResp.headers["connection"] = "close";
        }
        return self._onResponseHeaders(ctx, (err) => {
          if (err) {
            return self._onError("ON_RESPONSEHEADERS_ERROR", ctx, err);
          }
          ctx.proxyToClientResponse.writeHead(
            servToProxyResp!.statusCode!,
            Proxy.filterAndCanonizeHeaders(servToProxyResp.headers)
          );
          // @ts-ignore
          ctx.responseFilters.push(new ProxyFinalResponseFilter(self, ctx));
          let prevResponsePipeElem = servToProxyResp;
          ctx.responseFilters.forEach((filter) => {
            filter.on(
              "error",
              self._onError.bind(self, "RESPONSE_FILTER_ERROR", ctx)
            );
            prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
          });
          return servToProxyResp.resume();
        });
      });
    }

    function makeProxyToServerRequest() {
      const proto = ctx.isSSL ? https : http;
      ctx.proxyToServerRequest = proto.request(
        ctx.proxyToServerRequestOptions!,
        proxyToServerRequestComplete
      );
      ctx.proxyToServerRequest.on(
        "error",
        self._onError.bind(self, "PROXY_TO_SERVER_REQUEST_ERROR", ctx)
      );
      ctx.requestFilters.push(new ProxyFinalRequestFilter(self, ctx));
      let prevRequestPipeElem = ctx.clientToProxyRequest;
      ctx.requestFilters.forEach((filter) => {
        filter.on(
          "error",
          self._onError.bind(self, "REQUEST_FILTER_ERROR", ctx)
        );
        prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
      });
      ctx.clientToProxyRequest.resume();
    }

    if (hostPort === null) {
      ctx.clientToProxyRequest.resume();
      ctx.proxyToClientResponse.writeHead(400, {
        "Content-Type": "text/html; charset=utf-8",
      });
      ctx.proxyToClientResponse.end("Bad request: Host missing...", "utf-8");
    } else {
      const headers = {};
      for (const h in ctx.clientToProxyRequest.headers) {
        // don't forward proxy-headers
        if (!/^proxy-/i.test(h)) {
          headers[h] = ctx.clientToProxyRequest.headers[h];
        }
      }
      if (this.options.forceChunkedRequest) {
        delete headers["content-length"];
      }

      ctx.proxyToServerRequestOptions = {
        method: ctx.clientToProxyRequest.method!,
        path: ctx.clientToProxyRequest.url!,
        host: hostPort.host,
        port: hostPort.port,
        headers,
        agent: ctx.isSSL ? self.httpsAgent : self.httpAgent,
      };
      return self._onRequest(ctx, (err) => {
        if (err) {
          return self._onError("ON_REQUEST_ERROR", ctx, err);
        }
        return self._onRequestHeaders(ctx, (err: Error | undefined | null) => {
          if (err) {
            return self._onError("ON_REQUESTHEADERS_ERROR", ctx, err);
          }
          return makeProxyToServerRequest();
        });
      });
    }
  }

  _onRequestHeaders(ctx: IContext, callback: ErrorCallback) {
    async.forEach(
      this.onRequestHeadersHandlers,
      (fn, callback) => fn(ctx, callback),
      callback
    );
  }

  _onRequest(ctx: IContext, callback: ErrorCallback) {
    async.forEach(
      this.onRequestHandlers.concat(ctx.onRequestHandlers),
      (fn, callback) => fn(ctx, callback),
      callback
    );
  }

  _onWebSocketConnection(ctx: IWebSocketContext, callback: ErrorCallback) {
    async.forEach(
      this.onWebSocketConnectionHandlers.concat(
        ctx.onWebSocketConnectionHandlers
      ),
      (fn, callback) => fn(ctx, callback),
      callback
    );
  }

  _onWebSocketFrame(
    ctx: IWebSocketContext,
    type: string,
    fromServer: boolean,
    data: WebSocket.RawData,
    flags?: WebSocketFlags | boolean
  ) {
    const self = this;
    async.forEach(
      this.onWebSocketFrameHandlers.concat(ctx.onWebSocketFrameHandlers),
      (fn, callback: IWebSocketCallback) =>
        fn(ctx, type, fromServer, data, flags, (err, newData, newFlags) => {
          if (err) {
            return callback(err);
          }
          data = newData;
          flags = newFlags;
          return callback(null, data, flags);
        }),
      (err) => {
        if (err) {
          return self._onWebSocketError(ctx, err);
        }
        const destWebSocket = fromServer
          ? ctx.clientToProxyWebSocket!
          : ctx.proxyToServerWebSocket!;
        if (destWebSocket.readyState === WebSocket.OPEN) {
          switch (type) {
            case "message":
              destWebSocket.send(data, {binary: flags as boolean});
              break;
            case "ping":
              destWebSocket.ping(data, flags as boolean);
              break;
            case "pong":
              destWebSocket.pong(data, flags as boolean);
              break;
          }
        } else {
          self._onWebSocketError(
            ctx,
            new Error(
              `Cannot send ${type} because ${
                fromServer ? "clientToProxy" : "proxyToServer"
              } WebSocket connection state is not OPEN`
            )
          );
        }
      }
    );
  }

  _onWebSocketClose(
    ctx: IWebSocketContext,
    closedByServer: boolean,
    code: number,
    message: Buffer
  ) {
    const self = this;
    if (!ctx.closedByServer && !ctx.closedByClient) {
      ctx.closedByServer = closedByServer;
      ctx.closedByClient = !closedByServer;
      async.forEach(
        this.onWebSocketCloseHandlers.concat(ctx.onWebSocketCloseHandlers),
        (fn, callback) => fn(ctx, code, message, callback),
        (err) => {
          if (err) {
            return self._onWebSocketError(ctx, err);
          }
          const clientToProxyWebSocket = ctx.clientToProxyWebSocket!;
          const proxyToServerWebSocket = ctx.proxyToServerWebSocket!;
          if (
            clientToProxyWebSocket.readyState !==
            proxyToServerWebSocket.readyState
          ) {
            try {
              if (
                clientToProxyWebSocket.readyState === WebSocket.CLOSED &&
                proxyToServerWebSocket.readyState === WebSocket.OPEN
              ) {
                code === 1005
                  ? proxyToServerWebSocket.close()
                  : proxyToServerWebSocket.close(code, message);
              } else if (
                proxyToServerWebSocket.readyState === WebSocket.CLOSED &&
                clientToProxyWebSocket.readyState === WebSocket.OPEN
              ) {
                code === 1005
                  ? proxyToServerWebSocket.close()
                  : clientToProxyWebSocket.close(code, message);
              }
            } catch (err: any) {
              return self._onWebSocketError(ctx, err);
            }
          }
        }
      );
    }
  }

  _onWebSocketError(ctx: IWebSocketContext, err: Error) {
    this.onWebSocketErrorHandlers.forEach((handler) => handler(ctx, err));
    if (ctx) {
      ctx.onWebSocketErrorHandlers.forEach((handler) => handler(ctx, err));
    }
    const clientToProxyWebSocket = ctx.clientToProxyWebSocket!;
    const proxyToServerWebSocket = ctx.proxyToServerWebSocket!;
    if (
      proxyToServerWebSocket &&
      clientToProxyWebSocket.readyState !== proxyToServerWebSocket.readyState
    ) {
      try {
        if (
          clientToProxyWebSocket.readyState === WebSocket.CLOSED &&
          proxyToServerWebSocket.readyState === WebSocket.OPEN
        ) {
          proxyToServerWebSocket.close();
        } else if (
          proxyToServerWebSocket.readyState === WebSocket.CLOSED &&
          clientToProxyWebSocket.readyState === WebSocket.OPEN
        ) {
          clientToProxyWebSocket.close();
        }
      } catch (err) {
        // ignore
      }
    }
  }

  _onRequestData(ctx: IContext, chunk, callback) {
    const self = this;
    async.forEach(
      this.onRequestDataHandlers.concat(ctx.onRequestDataHandlers),
      (fn, callback: OnRequestDataCallback) =>
        fn(ctx, chunk, (err, newChunk) => {
          if (err) {
            return callback(err);
          }
          chunk = newChunk;
          return callback(null, newChunk);
        }),
      (err) => {
        if (err) {
          return self._onError("ON_REQUEST_DATA_ERROR", ctx, err);
        }
        return callback(null, chunk);
      }
    );
  }

  _onRequestEnd(ctx: IContext, callback: ErrorCallback) {
    const self = this;
    async.forEach(
      this.onRequestEndHandlers.concat(ctx.onRequestEndHandlers),
      (fn, callback) => fn(ctx, callback),
      (err) => {
        if (err) {
          return self._onError("ON_REQUEST_END_ERROR", ctx, err);
        }
        return callback(null);
      }
    );
  }

  _onResponse(ctx: IContext, callback: ErrorCallback) {
    async.forEach(
      this.onResponseHandlers.concat(ctx.onResponseHandlers),
      (fn, callback) => fn(ctx, callback),
      callback
    );
  }

  _onResponseHeaders(ctx: IContext, callback: ErrorCallback) {
    async.forEach(
      this.onResponseHeadersHandlers,
      (fn, callback) => fn(ctx, callback),
      callback
    );
  }

  _onResponseData(ctx: IContext, chunk, callback: ErrorCallback) {
    async.forEach(
      this.onResponseDataHandlers.concat(ctx.onResponseDataHandlers),
      (fn, callback: OnRequestDataCallback) =>
        fn(ctx, chunk, (err, newChunk) => {
          if (err) {
            return callback(err);
          }
          chunk = newChunk;
          return callback(null, newChunk);
        }),
      (err) => {
        if (err) {
          return this._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
        }
        return callback(null, chunk);
      }
    );
  }

  _onResponseEnd(ctx: IContext, callback: ErrorCallback) {
    async.forEach(
      this.onResponseEndHandlers.concat(ctx.onResponseEndHandlers),
      (fn, callback) => fn(ctx, callback),
      (err) => {
        if (err) {
          return this._onError("ON_RESPONSE_END_ERROR", ctx, err);
        }
        return callback(null);
      }
    );
  }

  static parseHostAndPort(req: http.IncomingMessage, defaultPort?: number) {
    const m = req.url!.match(/^http:\/\/([^/]+)(.*)/);
    if (m) {
      req.url = m[2] || "/";
      return Proxy.parseHost(m[1], defaultPort);
    } else if (req.headers.host) {
      return Proxy.parseHost(req.headers.host, defaultPort);
    } else {
      return null;
    }
  }

  static parseHost(
    hostString: string,
    defaultPort?: number
  ): { host: string; port: number | undefined } {
    const m = hostString.match(/^http:\/\/(.*)/);
    if (m) {
      const parsedUrl = url.parse(hostString);
      return {
        host: parsedUrl.hostname as string,
        port: Number(parsedUrl.port),
      };
    }

    const hostPort = hostString.split(":");
    const host = hostPort[0];
    const port = hostPort.length === 2 ? +hostPort[1] : defaultPort;

    return {
      host,
      port,
    };
  }

  static filterAndCanonizeHeaders(originalHeaders: IncomingHttpHeaders) {
    const headers = {};
    for (const key in originalHeaders) {
      const canonizedKey = key.trim();
      if (/^public-key-pins/i.test(canonizedKey)) {
        // HPKP header => filter
        continue;
      }

      headers[canonizedKey] = originalHeaders[key];
    }

    return headers;
  }
}
