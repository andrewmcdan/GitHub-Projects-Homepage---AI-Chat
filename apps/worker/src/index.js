const intervalMs = Number(process.env.WORKER_IDLE_MS || 60000);

console.log("Worker started. No jobs configured yet.");

setInterval(() => {}, intervalMs);
