/**
 * Knowing whether a write actually reached the disk.
 *
 * `collection.insert()` updates memory and returns a transaction; the flush to
 * OPFS happens afterwards, and `isPersisted.promise` is how you learn it landed.
 * The app used to throw that promise away at all thirty-four write sites, which
 * is why a set logged and then followed by a reload one tick later vanished six
 * times out of twenty-five — and why two writes in the same tick lost one every
 * single time.
 *
 * This is deliberately not part of `syncable`. That wrapper answers "has the
 * other device seen this", which is a different question with a different failure
 * mode and a different remedy: a record that has not synced is safe on this
 * device, while a record that has not persisted is one power cut from gone.
 * Folding both into one wrapper would make it impossible to say which of the two
 * a given number referred to.
 *
 * Two things come out of here. Call sites get the transaction back so the ones
 * holding training data can await it. And the tracker counts what is still in
 * flight, so the page teardown can tell whether it is safe to let go — without
 * anybody having to remember to register anything.
 */

/** What a collection write returns: a transaction that settles when it lands. */
type WriteResult = {
	isPersisted?: { promise?: Promise<unknown> };
};

export type DurabilityFailure = {
	at: number;
	error: unknown;
};

export type DurabilityTracker = {
	/** Writes that have updated memory and may not have reached disk yet. */
	readonly pendingCount: number;
	/** Resolves when everything registered so far has settled — landed or failed. */
	whenAllPersisted(): Promise<void>;
	/** Registers a write. Returns it untouched so callers can still await it. */
	track<T>(result: T): T;
	/** Failures, kept rather than swallowed: a write that did not land is news. */
	readonly failures: readonly DurabilityFailure[];
	/** Notified whenever the pending count changes. */
	subscribe(listener: (pending: number) => void): () => void;
	/**
	 * Notified when a write fails to land. Separate from `subscribe` because a
	 * failure is news and a changing count is not — a screen wants to say
	 * something about one and nothing about the other.
	 */
	onFailure(listener: (failure: DurabilityFailure) => void): () => void;
};

export function createDurabilityTracker(): DurabilityTracker {
	let pending = 0;
	const failures: DurabilityFailure[] = [];
	const listeners = new Set<(pending: number) => void>();
	const failureListeners = new Set<(failure: DurabilityFailure) => void>();
	/** Everything in flight, so `whenAllPersisted` has something to await. */
	const inFlight = new Set<Promise<unknown>>();

	function announce(): void {
		for (const listener of listeners) listener(pending);
	}

	return {
		get pendingCount() {
			return pending;
		},

		get failures() {
			return failures;
		},

		track<T>(result: T): T {
			const promise = (result as WriteResult)?.isPersisted?.promise;
			// A write with no promise to wait on is already as done as it gets.
			if (!promise) return result;

			pending++;
			announce();

			/*
			 * One hop, not two. Chaining `.catch().finally()` puts the decrement two
			 * microtasks after settlement while the caller's `await` is one — so a
			 * caller that awaited its own write still saw a non-zero count, and the
			 * page teardown read that as "writes in flight" and declined to release
			 * the database. Attached first and settled in a single `then`, the count
			 * is right by the time anyone can look at it.
			 */
			const done = () => {
				pending--;
				inFlight.delete(settled);
				announce();
			};

			const settled = promise.then(done, (error: unknown) => {
				// Recorded, not rethrown: this is a bookkeeping observer, and an
				// unhandled rejection here would be noise on top of a real failure
				// the caller is already free to handle on its own copy of the promise.
				const failure = { at: Date.now(), error };
				failures.push(failure);
				for (const listener of failureListeners) listener(failure);
				done();
			});

			inFlight.add(settled);
			return result;
		},

		async whenAllPersisted(): Promise<void> {
			// Awaiting can let more writes start, so this drains rather than
			// snapshotting once.
			while (inFlight.size > 0) {
				await Promise.all([...inFlight]);
			}
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		onFailure(listener) {
			failureListeners.add(listener);
			return () => failureListeners.delete(listener);
		},
	};
}

/**
 * A collection whose writes are counted.
 *
 * Wrapping is what makes this reliable: the alternative is asking every one of
 * thirty-four call sites to register its own transaction, and the one that forgets
 * is the one that loses a set.
 */
export function durable<C extends object>(
	collection: C,
	tracker: DurabilityTracker,
): C {
	const target = collection as C & Record<string, unknown>;

	return new Proxy(target, {
		get(_, property, receiver) {
			if (
				property === "insert" ||
				property === "update" ||
				property === "delete"
			) {
				const original = Reflect.get(target, property, receiver) as (
					...args: unknown[]
				) => unknown;
				return (...args: unknown[]) =>
					tracker.track(original.apply(target, args));
			}
			return Reflect.get(target, property, receiver);
		},
	}) as C;
}

/**
 * Awaits a write and reports whether it landed, without ever rejecting.
 *
 * The call sites that hold training data need to wait for the disk, but they must
 * not blow up on the way: a rejected `isPersisted` left unhandled is a silent
 * failure plus an unhandled rejection, which is the worst of both. The tracker has
 * already recorded the error and told anyone listening — this is just how a caller
 * waits without turning a bad disk into a crash.
 */
export async function persisted(transaction: {
	isPersisted?: { promise?: Promise<unknown> };
}): Promise<boolean> {
	const promise = transaction?.isPersisted?.promise;
	if (!promise) return true;

	try {
		await promise;
		return true;
	} catch {
		return false;
	}
}
