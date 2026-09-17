/**
 * Observe both presenter renders while allowing narration to await only the
 * current page. A late preview failure is still reported, unless superseded.
 */
export async function settlePreviewRenders(current, next, {
  waitForNext = true,
  isCurrent,
  isCurrentRendered,
  onError,
}) {
  let reportedError = false;
  const observe = promise => Promise.resolve(promise).then(() => true, error => {
    if (isCurrent() && !reportedError) {
      reportedError = true;
      onError(error);
    }
    return false;
  });

  // Attach both rejection handlers immediately, including when next-page work
  // is intentionally left running after the current page becomes ready.
  const currentDone = observe(current);
  const nextDone = next === null ? Promise.resolve(true) : observe(next);
  const currentSucceeded = await currentDone;
  if (waitForNext) await nextDone;
  return currentSucceeded && isCurrent() && isCurrentRendered();
}
