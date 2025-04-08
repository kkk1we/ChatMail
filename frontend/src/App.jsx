import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Callback from './components/Callback';
import EmailList from './components/EmailList';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/session', {
          credentials: 'include',
        });

        if (res.status === 200) {
          setIsLoggedIn(true);
        } else {
          setIsLoggedIn(false);
        }
      } catch (err) {
        console.error('❌ Session check failed:', err);
        setIsLoggedIn(false);
      } finally {
        setCheckingSession(false);
      }
    };

    checkSession();
  }, []);

  if (checkingSession) return <p>🔄 Checking session...</p>;

  return (
    <Router>
      <Routes>
        <Route path="/" element={isLoggedIn ? <EmailList /> : <Login />} />
        <Route path="/auth/callback" element={<Callback onLogin={() => setIsLoggedIn(true)} />} />
      </Routes>
    </Router>
  );
}

export default App;
