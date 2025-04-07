
// ✅ Callback.jsx
import { useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
console.log('test')
export default function Callback({ onLogin }) {
  const navigate = useNavigate();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    console.log("🔍 Code param:", code);

    const handleOAuthRedirect = async () => {
      const code = new URLSearchParams(window.location.search).get('code');
      if (!code) return;

      try {
        const res = await axios.get(`http://localhost:5000/api/oauth2callback?code=${code}`);
        const accessToken = res.data.tokens?.access_token;

        console.log('✅ Access Token:', accessToken);
        localStorage.setItem('accessToken', accessToken);
        onLogin({ accessToken });

        navigate('/');
      } catch (error) {
        console.error('OAuth callback failed:', error);
      }
    };

    handleOAuthRedirect();
  }, []);

  return <p>Logging you in...</p>;
}