import { useEffect, useState } from 'react';
import axios from 'axios';
import './EmailList.css'; // Optional: externalize CSS for animation

function cleanBody(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(html|head|body|meta|title|link)[^>]*>/gi, '')
    .replace(/<div[^>]+class="gmail_quote"[^>]*>[\s\S]*$/gi, '') // Gmail reply thread
    .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '')     // Outlook/Gmail blockquotes
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


function getDateLabel(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'long' });
}

export default function EmailList({ token }) {
  const [threads, setThreads] = useState([]);
  const [expandedThreadId, setExpandedThreadId] = useState(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(5);
  const [threadSearch, setThreadSearch] = useState('');

  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/emails', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setThreads(res.data);
      } catch (error) {
        if (error.response?.status === 401) {
          localStorage.removeItem('accessToken');
          window.location.href = '/';
        } else {
          console.error('Email fetch failed:', error.response?.data || error.message);
        }
      }
    };

    if (token) fetchEmails();
  }, [token]);

  const toggleThread = (id) => {
    setExpandedThreadId(expandedThreadId === id ? null : id);
    setThreadSearch('');
  };

  const getInitials = (from) => {
    const name = from.split('<')[0].trim();
    return name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
  };

  const filteredThreads = threads
    .filter((thread) =>
      thread.subject?.toLowerCase().includes(search.toLowerCase()) ||
      thread.messages?.some(msg =>
        msg.from?.toLowerCase().includes(search.toLowerCase()) ||
        msg.body?.toLowerCase().includes(search.toLowerCase())
      )
    )
    .slice(0, visibleCount);

  return (
    <div className="email-list" style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <input
        type="text"
        placeholder="🔍 Search all threads..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '10px', width: '100%', marginBottom: '20px', borderRadius: '8px', border: '1px solid #ccc' }}
      />

      {filteredThreads.length > 0 ? (
        filteredThreads.map((thread) => {
          const expanded = expandedThreadId === thread.id;
          const filteredMsgs = thread.messages.filter(msg =>
            msg.from.toLowerCase().includes(threadSearch.toLowerCase()) ||
            msg.body.toLowerCase().includes(threadSearch.toLowerCase())
          );

          let lastDateLabel = '';

          return (
            <div
              key={thread.id}
              className={`email-thread ${expanded ? 'expanded' : ''}`}
              style={{
                border: '2px solid #ccc',
                borderRadius: '10px',
                padding: '15px',
                marginBottom: '25px',
                backgroundColor: '#fafafa',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
              }}
            >
              <h3 style={{ cursor: 'pointer', color: '#333' }} onClick={() => toggleThread(thread.id)}>
                📬 {thread.subject || '(no subject)'}
              </h3>

              {expanded && (
                <div style={{ marginTop: '10px' }}>
                  <input
                    type="text"
                    placeholder="Search in this thread..."
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                    style={{ padding: '8px', width: '100%', marginBottom: '10px', borderRadius: '6px', border: '1px solid #aaa' }}
                  />

                  <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                    {filteredMsgs.map((msg, i) => {
                      const dateLabel = getDateLabel(msg.date);
                      const showDateLabel = dateLabel !== lastDateLabel;
                      lastDateLabel = dateLabel;

                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                          {showDateLabel && (
                            <div style={{
                              textAlign: 'center',
                              margin: '15px 0 5px',
                              color: '#666',
                              fontSize: '0.85em',
                              fontWeight: 'bold'
                            }}>
                              ── {dateLabel} ──
                            </div>
                          )}
                          <div
                            className="message"
                            style={{
                              display: 'flex',
                              alignSelf: msg.isMe ? 'flex-end' : 'flex-start',
                              maxWidth: '75%',
                              backgroundColor: msg.isMe ? '#dcf8c6' : '#fff',
                              padding: '10px',
                              borderRadius: '10px',
                              margin: '5px 0',
                              border: msg.isMe ? '1px solid #a2d5a2' : '1px solid #ccc',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            }}
                          >
                            <div
                              className="avatar"
                              style={{
                                backgroundColor: '#888',
                                color: '#fff',
                                borderRadius: '50%',
                                width: '36px',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.9em',
                                marginRight: '10px',
                              }}
                            >
                              {getInitials(msg.from)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 'bold' }}>{msg.from}</div>
                              <div
                                className="email-body"
                                style={{ marginTop: '6px', marginBottom: '8px' }}
                                dangerouslySetInnerHTML={{ __html: cleanBody(msg.body) }}
                              />
                              <div style={{ fontSize: '0.8em', color: '#888' }}>
                                {new Date(msg.date).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reply box (UI only) */}
                  <div style={{ marginTop: '10px' }}>
                    <textarea
                      placeholder="Type your reply..."
                      rows={3}
                      style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                    />
                    <button style={{
                      marginTop: '5px',
                      padding: '8px 16px',
                      backgroundColor: '#4caf50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}>
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <p>📨 Loading emails...</p>
      )}

      {visibleCount < threads.length && (
        <button
          onClick={() => setVisibleCount(prev => prev + 5)}
          style={{
            marginTop: '15px',
            padding: '10px 18px',
            borderRadius: '8px',
            backgroundColor: '#4caf50',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Load More
        </button>
      )}
    </div>
  );
}
