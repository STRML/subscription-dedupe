// @flow

//
// Class for deduping subscriptions. If a subscription is already open, we return the resolved promise
// with the emitter.
//
// One complication is the following:
// 1. User opens subscription to 'instrument:XBTUSD'
// 2. Another user opens subscription to 'instrument', which supersedes
// 3. User unsubscribes from 'instrument:XBTUSD' - because of higher-priority sub, despite refcount being 0, no action
//
// Can we do this programmatically so this module doesn't have to know much about the above (like some bool-returning
// hook)?
//

/*::
type Options = {
  onSubscribe: (...args: any) => Promise<any>,
  onUnsubscribe: (...args: any) => Promise<any>,
};
type SubscriptionObject = {promise: Promise<any>, refCount: number, closing: ?{isReopened: boolean}};
type SubscriptionMap = {[key: string]: SubscriptionObject};
*/
module.exports = class SubscriptionDedupe {
  constructor(options /*: Options*/) {
    if (!options || !options.onSubscribe || !options.onUnsubscribe) {
      throw new Error("'onSubscribe', 'onUnsubscribe' required.");
    }
    this.subscriptions = {};
    this.options = options;
  }

  /*::
  options: Options;
  subscriptions: SubscriptionMap;
  */

  subscribe(topic /*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found, create the subscription object
      existing = this.subscriptions[topic] = {
        promise: this.options.onSubscribe(topic),
        refCount: 0,
        closing: null,
      };
    } else if (existing.closing) {
      existing.closing.isReopened = true;
      existing.closing = null;
      existing.promise = existing.promise.then(() =>
        this.options.onSubscribe(topic)
      );
    }

    existing.refCount++;
    return existing.promise;
  }

  unsubscribe(topic /*: string */) {
    let existing = this.subscriptions[topic];
    let promise;

    if (existing) {
      existing.refCount--;
      if (existing.refCount === 0) {
        // `.closing` is an object with a `isReopened` property
        // When reopening a connection, we update the `isReopened` property and
        // set `.closing` to `null`.
        // This way, multiple reopens will wait for each other.
        if (existing.closing) throw new Error("Already closing?");

        const closing = { isReopened: false };
        existing.closing = closing;
        // $FlowFixMe
        promise = existing.promise = existing.promise
          .then(() => this.options.onUnsubscribe(topic))
          .then(() => {
            if (!closing.isReopened) {
              delete this.subscriptions[topic];
            }
          });
      }
    }

    return promise || Promise.resolve();
  }
};
