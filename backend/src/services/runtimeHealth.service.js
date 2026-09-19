let shuttingDown = false;
let shutdownSignal = null;

export const markShuttingDown = (signal = "shutdown") => {
    shuttingDown = true;
    shutdownSignal = signal;
};

export const runtimeHealth = () => ({
    shuttingDown,
    shutdownSignal,
    uptimeSeconds: Math.floor(process.uptime()),
});

export const resetRuntimeHealthForTests = () => {
    shuttingDown = false;
    shutdownSignal = null;
};
