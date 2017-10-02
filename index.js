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
  addListener: (...args: any) => Promise<any>,
  removeListener: (...args: any) => Promise<any>,
  delimiter: string,
  levels: number,
};
type SubscriptionObject = {promise: Promise<any>, refCount: number};
type SubscriptionMap = {[key: string]: SubscriptionObject};
*/
module.exports = class SubscriptionDedupe {
  constructor(options/*: Options*/) {
    if (!options || !options.addListener || !options.removeListener || !options.delimiter || !options.levels) {
      throw new Error("'addListener', 'removeListener', 'delimiter' required.");
    }
    this.subscriptions = {};
    this.structuredSubscriptions = {};
    this.options = options;
  }

  /*::
  options: Options;
  // Only the last node actually contains the subscription, for performance reasons; this is why
  // we require 'levels'
  structuredSubscriptions: {[key: string]: SubscriptionObject | SubscriptionMap};
  subscriptions: SubscriptionMap;
  */

  addSubscription(topic/*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found; search up the tree for wildcards
      existing = this._findInStack(topic);
    }

    if (!existing) {
      // Nothing found, create the subscription object
      existing = this.subscriptions[topic] = {
        promise: this.options.addListener(topic),
        refCount: 0
      };
      const split = topic.split(this.options.delimiter);
      for (let i = 0; i < split.length; i++) {
        if (this.structuredSubscriptions[split[i]]) this.structuredSubscriptions[split[i]] = {};
      }

      // This might be less specific than an existing sub, in which case we merge them upward
      // e.g. if topic === 'foo:*', any existing 'foo:bar' gets merged up to 'foo:*''s refCount
      this._mergeFromStack(topic);
    }

    existing.refCount++;
    return existing.promise;
  }

  removeSubscription(topic/*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found; search up the tree for wildcards
      existing = this._findInStack(topic);
    }

    if (existing) {
      existing.refCount--;
      if (existing.refCount === 0) {
        this.options.removeListener(topic);
        delete this.subscriptions[topic];
      }
    }
  }

  _findInStack(topic/*: string */) {
    const {delimiter, levels} = this.options;
    const split = topic.split(this.options.delimiter);
    if (process.env.NODE_ENV !== 'production') {
      if (split.length !== levels) {
        throw new Error(`Incorrect 'levels': topic ${topic} contained ${split.length} levels, not ${levels}.`);
      }
      let hasWildcard = true;
      for (const level of split) {
        if (level === '*') {
          if (wildcardIdx >= 0) {
            throw new Error(`Invalid trailing wildcard found in topic: ${topic}`);
          }
          wildcardIdx = level;
        }
      }
    }


    let existing;
    console.log({topic});
    for (let i = levels - 1; i >= 0; i--) {
      if (split[i] !== '*') {
        console.log({i});
        const keyArr = [...split.slice(0, i)];
        while (keyArr.length < levels) keyArr.push('*');
        const key = keyArr.join(delimiter);
        console.log({key});
        existing = this.subscriptions[key];
        if (existing) break;
      }
    }

    console.log({existing});
    return existing;
  }

  _mergeFromStack(topic/*: string */) {
    const {delimiter, levels} = this.options;
    const split = topic.split(this.options.delimiter);

    let base = this.structuredSubscriptions;
    for (const level of split) {
      if (level === '*' && Object.keys(base).length > 1) {
        // We're less specific, merge up the stack


      }
      // $FlowIgnore doesn't know only last level is SubscriptionObject
      base = base[level];
      if (!base) throw new Error('wat');
    }
  }

}
