export class CircuitOpenError extends Error {
    constructor(name, retryAfterMs) {
        super(`${name} circuit is open`);
        this.name = "CircuitOpenError";
        this.code = "CIRCUIT_OPEN";
        this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
    }
}

export class CircuitBreaker {
    constructor({
        name,
        failureThreshold = 3,
        cooldownMs = 30_000,
        isFailure = () => true,
        now = () => Date.now(),
    }) {
        this.name = name || "dependency";
        this.failureThreshold = Math.max(1, Number(failureThreshold) || 3);
        this.cooldownMs = Math.max(1_000, Number(cooldownMs) || 30_000);
        this.isFailure = isFailure;
        this.now = now;
        this.reset();
    }

    reset() {
        this.state = "closed";
        this.failures = 0;
        this.openedAt = null;
        this.lastFailureAt = null;
        this.lastFailureCode = null;
        this.halfOpenProbeInFlight = false;
    }

    snapshot() {
        const now = this.now();
        const retryAfterMs =
            this.state === "open" && this.openedAt != null
                ? Math.max(0, this.cooldownMs - (now - this.openedAt))
                : 0;

        return {
            state: this.state,
            failures: this.failures,
            failureThreshold: this.failureThreshold,
            cooldownMs: this.cooldownMs,
            retryAfterMs,
            lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
            lastFailureCode: this.lastFailureCode,
        };
    }

    #open(error) {
        this.state = "open";
        this.openedAt = this.now();
        this.halfOpenProbeInFlight = false;
        this.lastFailureAt = this.openedAt;
        this.lastFailureCode = String(error?.code || error?.name || "ERROR").slice(0, 120);
    }

    #acquire() {
        if (this.state === "open") {
            const elapsed = this.now() - this.openedAt;
            if (elapsed < this.cooldownMs) {
                throw new CircuitOpenError(this.name, this.cooldownMs - elapsed);
            }
            this.state = "half_open";
        }

        if (this.state === "half_open") {
            if (this.halfOpenProbeInFlight) throw new CircuitOpenError(this.name, this.cooldownMs);
            this.halfOpenProbeInFlight = true;
        }
    }

    #onSuccess() {
        this.state = "closed";
        this.failures = 0;
        this.openedAt = null;
        this.lastFailureCode = null;
        this.halfOpenProbeInFlight = false;
    }

    #onFailure(error) {
        this.lastFailureAt = this.now();
        this.lastFailureCode = String(error?.code || error?.name || "ERROR").slice(0, 120);

        if (!this.isFailure(error)) {
            // The dependency answered, so a non-infrastructure error should not
            // contribute to an outage circuit (for example a bad user request).
            this.#onSuccess();
            return;
        }

        if (this.state === "half_open") {
            this.#open(error);
            return;
        }

        this.failures += 1;
        if (this.failures >= this.failureThreshold) this.#open(error);
    }

    async execute(work) {
        this.#acquire();
        try {
            const result = await work();
            this.#onSuccess();
            return result;
        } catch (error) {
            this.#onFailure(error);
            throw error;
        } finally {
            if (this.state !== "half_open") this.halfOpenProbeInFlight = false;
        }
    }
}
