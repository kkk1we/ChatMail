import axios from 'axios';

export default function Login() {
  const handleGoogleLogin = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/login-url');
      window.location.href = res.data.url;
    } catch (error) {
      console.error('Login URL error:', error);
    }
  };

  return (
    <div className="login-container">
      <h2>Login with Google</h2>
      <button onClick={handleGoogleLogin}>Sign in with Google</button>
    </div>
  );
}