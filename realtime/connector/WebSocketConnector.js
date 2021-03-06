"use strict";
const CommunicationError = require('../../lib/error/CommunicationError');
const WebSocket = require('./websocket').WebSocket;
const lib = require('../../lib');
const util = require('../../lib/util/util');

/**
 * @alias connector.WebSocketConnector
 */
class WebSocketConnector {

  /**
   * @param {connector.Connector} connector a connector
   * @param {String=} url The websocket connect script url
   * @return {connector.WebSocketConnector} a websocket connection
   */
  static create(url) {
    let websocket = this.websockets[url];
    if (!websocket) {
      websocket = new WebSocketConnector(url);
      this.websockets[url] = websocket;
    }
    return websocket;
  }

  /**
   * @param {String} url
   */
  constructor(url) {
    this.observers = {};
    this.socket = null;
    this.url = url;
  }

  open() {
    if (!this.socket) {
      const socket = new WebSocket(this.url);
      let socketPromise;

      const handleSocketCompletion = (error) => {
        //observable error calls can throw an exception therefore cleanup beforehand
        if (this.socket == socketPromise)
          this.socket = null;

        let firstErr;
        Object.keys(this.observers).forEach(id => {
          try {
            error? this.observers[id].error(error): this.observers[id].complete();
          } catch (e) {
            if (!firstErr)
              firstErr = e;
          }
          delete this.observers[id];
        });

        if (firstErr)
          throw firstErr;
      };

      socket.onerror = handleSocketCompletion;
      socket.onclose = handleSocketCompletion.bind(null, null);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        message.date = new Date(message.date);

        const id = message.id;
        if (!id) {
          if (message.type == 'error')
            handleSocketCompletion(new CommunicationError(null, message));
          return;
        }

        const observer = this.observers[id];
        if (observer) {
          if (message.type == "error") {
            observer.error(new CommunicationError(null, message));
          } else {
            observer.next(message);
          }
        }
      };

      socketPromise = this.socket = new Promise((resolve) => {
        socket.onopen = resolve;
      }).then(() => {
        return socket;
      });
    }

    return this.socket;
  }

  close() {
    if (this.socket) {
      this.socket.then((socket) => {
        socket.close();
      });
      this.socket = null;
    }
  }

  /**
   * @param {util.TokenStorage} tokenStorage
   * @return {connector.ObservableStream} The channel for sending and receiving messages
   */
  openStream(tokenStorage) {
    let id = util.uuid();
    let stream = new lib.Observable(observer => {
      if (this.observers[id])
        throw new Error("Only one subscription per stream is allowed.");

      this.observers[id] = observer;
      return () => {
        delete this.observers[id];
      }
    });

    stream.send = (message) => {
      this.open().then((socket) => {
        message.id = id;
        if (tokenStorage.token)
          message.token = tokenStorage.token;
        const jsonMessage = JSON.stringify(message);
        socket.send(jsonMessage);
      });
    };

    return stream;
  }
}

Object.assign(WebSocketConnector,  /** @lends connector.WebSocketConnector */ {
  /**
   * Map of all available connectors to their respective websocket connections
   * @type connector.Connector[]
   */
  websockets: {}
});

module.exports = WebSocketConnector;