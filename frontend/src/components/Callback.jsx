
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import { useEffect, useRef } from 'react';

export default function Callback({ onLogin }) {
  const navigate = useNavigate();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const code = new URLSearchParams(window.location.search).get('code');
    console.log("🔍 Code param:", code);

    const handleOAuthRedirect = async () => {
      if (!code) {
        console.error("❌ No code parameter in URL");
        navigate('/');
        return;
      }

      try {
        const res = await axios.get('http://localhost:5000/api/oauth2callback', {
          params: { code },
          withCredentials: true,
        });

        console.log('✅ OAuth callback response:', res.data);

        if (res.data?.message === 'Login successful') {
          window.history.replaceState({}, document.title, '/');
          onLogin?.();
          navigate('/');
        } else {
          console.error("❌ Unexpected response:", res.data);
          navigate('/');
        }
      } catch (error) {
        console.error("❌ OAuth callback failed:", error);
        navigate('/');
      }
    };

    handleOAuthRedirect();
  }, [navigate, onLogin]);

  return <p>🔄 Logging you in...</p>;
}
