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
  warnOnTooManyUnsubscribes?: boolean,
};
type SubscriptionObject = {promise: Promise<any>, refCount: number, closing?: {isReopened: boolean}};
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
      };
    } else if (existing.closing) {
      // This connection was closing, but did not finish.

      // Unsubscribe handler still will have a reference to this
      existing.closing.isReopened = true;
      existing.closing = undefined; // but we don't need it anymore
      existing.promise = existing.promise.then(() =>
        this.options.onSubscribe(topic)
      );
    }

    existing.refCount++;
    return existing.promise;
  }

  unsubscribe(topic /*: string */) {
    let existing = this.subscriptions[topic];

    if (existing) {
      existing.refCount--;
      if (existing.refCount < 0 || existing.closing) {
        // Don't allow this to go negative.
        // Will happen if you unsubscribe too many times.
        existing.refCount = 0;
        if (this.options.warnOnTooManyUnsubscribes !== false) {
          console.warn(`Attempted to close dedupe subscription for topic "${topic}", but it was already closing.`);
        }
      } else if (existing.refCount === 0) {
        // `.closing` is an object with a `isReopened` property
        // When reopening a connection, we update the `isReopened` property and
        // set `.closing` to `null`.
        const closing = { isReopened: false };
        existing.closing = closing;

        // $FlowFixMe
        existing.promise = existing.promise
          .then(() => this.options.onUnsubscribe(topic))
          .then(() => {
            if (!closing.isReopened) {
              delete this.subscriptions[topic];
            }
          });
      }
    }

    return existing ? existing.promise : Promise.resolve();
  }
};
