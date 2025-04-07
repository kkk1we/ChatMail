import { useEffect, useState } from 'react';
import axios from 'axios';

export default function EmailList({ token }) {
  const [emails, setEmails] = useState([]);

  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/emails', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        setEmails(res.data);
      } catch (error) {
        console.error('Email fetch failed:', error.response?.data || error.message);
      }
    };

    if (token) fetchEmails();
  }, [token]);

  return (
    <div className="email-list">
      {emails.length > 0 ? (
        emails.map(email => (
          <div key={email.id} className="email-item">
            <h3>{email.id}</h3>
            <p>{email.snippet || 'No snippet available'}</p>
          </div>
        ))
      ) : (
        <p>Loading emails...</p>
      )}
    </div>
  );
}
