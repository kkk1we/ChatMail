import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Callback from './components/Callback';
import EmailList from './components/EmailList';

function App() {
  const [user, setUser] = useState(() => {
    const accessToken = localStorage.getItem('accessToken');
    return accessToken ? { accessToken } : null;
  });

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <EmailList token={user.accessToken} /> : <Login />} />
        <Route path="/auth/callback" element={<Callback onLogin={setUser} />} />
      </Routes>
    </Router>
  );
}

export default App;