import { useEffect, useState } from 'react';
import App from './App';
import Landing from './pages/Landing';

// Minimal hash routing: "#/app" is the chat app, everything else (including
// in-page anchors like "#how") is the landing page.
function isAppRoute() {
  return window.location.hash.startsWith('#/app');
}

export default function Root() {
  const [showApp, setShowApp] = useState(isAppRoute);

  useEffect(() => {
    const onHashChange = () => {
      const next = isAppRoute();
      setShowApp((prev) => {
        if (prev !== next) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return showApp ? <App /> : <Landing />;
}
