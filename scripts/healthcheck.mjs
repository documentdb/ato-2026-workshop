try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.error(`Application readiness check returned HTTP ${response.status}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Application readiness check failed (${error.name}).`);
  process.exitCode = 1;
}
