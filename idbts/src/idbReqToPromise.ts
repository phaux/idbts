/**
 * Converts an {@link IDBRequest} to a Promise.
 */
export const idbReqToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", handleSuccess);
      request.removeEventListener("error", handleError);
    };
    const handleSuccess = () => {
      unlisten();
      resolve(request.result);
    };
    const handleError = () => {
      unlisten();
      reject(request.error ?? new DOMException("Unknown error", "AbortError"));
    };
    request.addEventListener("success", handleSuccess);
    request.addEventListener("error", handleError);
  });
