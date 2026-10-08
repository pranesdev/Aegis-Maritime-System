// Runtime env loader.
export function getRuntimeEnv() {
  if (typeof window !== 'undefined' && window.__ENV__) {
    const env = window.__ENV__;
    if (env.NEXT_PUBLIC_BACKEND_URL) {
      if (env.NEXT_PUBLIC_BACKEND_URL.includes('yourdomain.com')) {
        console.error('❌ CRITICAL ERROR: NEXT_PUBLIC_BACKEND_URL contains the default placeholder "yourdomain.com". The dashboard cannot connect to the backend. Please fix your .env file!');
        throw new Error('NEXT_PUBLIC_BACKEND_URL is misconfigured with placeholder values.');
      }
      return env;
    }
  }

  // Determine origin based on the browser's current URL. 
  // If in Vite dev (3000), requests go to 3000 and proxy to 4000.
  // If in Prod (4000), requests go to 4000 directly.
  let origin = '';
  if (typeof window !== 'undefined' && window.location) {
    origin = window.location.origin;
  }

  const backendUrl = import.meta.env.VITE_BACKEND_URL
    || (import.meta.env.PROD ? 'https://aegis-maritime-system-2.onrender.com' : origin);

  return {
    NEXT_PUBLIC_BACKEND_URL: backendUrl,
    NEXT_PUBLIC_API_URL: backendUrl,
    NEXT_PUBLIC_SOCKET_URL: import.meta.env.VITE_SOCKET_URL || backendUrl,
  };
}
