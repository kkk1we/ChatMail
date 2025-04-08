import { useEffect, useState } from 'react';
import axios from 'axios';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import './EmailList.css';

function cleanBody(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(html|head|body|meta|title|link)[^>]*>/gi, '')
    .replace(/<div[^>]+class="gmail_quote"[^>]*>[\s\S]*$/gi, '')
    .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '')
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
  const [showPreview, setShowPreview] = useState(false);
  const [profile, setProfile] = useState(null);
  const [threads, setThreads] = useState([]);
  const [expandedThreadId, setExpandedThreadId] = useState(null);
  const [search, setSearch] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [pendingReplyMeta, setPendingReplyMeta] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [followEmails, setFollowEmails] = useState([]);  // List of followed emails
  const [emailInput, setEmailInput] = useState('');

  const editor = useEditor({
    extensions: [StarterKit],
    editorProps: {
      handleKeyDown(view, event) {
        if (event.key === 'Tab') {
          event.preventDefault();
          view.dispatch(
            view.state.tr.insertText('    ') // inserts 4 spaces as indent
          );
          return true;
        }
        return false;
      }
    },
    content: '',
  });

  const getReplyText = () => editor?.getHTML() || '';
  const setReplyText = (html) => editor?.commands.setContent(html);

  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const res = await axios.post('http://localhost:5000/api/emails/followed', {
          senders: followEmails,
        });
        setThreads(res.data);
      } catch (error) {
        console.error('❌ Email fetch failed:', error.response?.data || error.message);
      }
    };

    if (followEmails.length > 0) {
      fetchEmails();
    }
  }, [followEmails]);
  
  const handleAddEmail = () => {
    if (emailInput && !followEmails.includes(emailInput)) {
      setFollowEmails((prev) => [...prev, emailInput]);
      setEmailInput('');
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/profile', {
          withCredentials: true,
        });
        setProfile(res.data);
      } catch (err) {
        console.error('❌ Failed to load profile:', err.message);
      }
    };

    fetchProfile();
  }, []);
  
  const toggleThread = (id) => {
    setExpandedThreadId(expandedThreadId === id ? null : id);
    setThreadSearch('');
    setReplyText('');
  };

  const getInitials = (from) => {
    const name = from.split('<')[0].trim();
    return name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
  };
  
  const appendLocalReply = (threadId, message) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          messages: [...t.messages, message],
        };
      })
    );
  };

  const sendReply = async (threadId, to, subject, isDraft) => {
    const html = getReplyText();
    try {
      await axios.post('http://localhost:5000/api/reply', {
        threadId,
        to,
        subject,
        message: html,
        draft: isDraft
      }, { withCredentials: true });

      appendLocalReply(threadId, {
        from: userEmail,
        subject,
        date: new Date().toISOString(),
        body: html,
      });

      if (isDraft) {
        alert('✅ Draft saved!');
      } else {
        alert('✅ Reply sent!');
      }

      setReplyText('');
    } catch (err) {
      console.error('❌ Reply failed:', err);
      alert('Failed to send reply.');
    }
  };

  const filteredThreads = threads
    .filter((thread) =>
      thread.subject?.toLowerCase().includes(search.toLowerCase()) ||
      thread.messages?.some(msg =>
        msg.from?.toLowerCase().includes(search.toLowerCase()) ||
        msg.body?.toLowerCase().includes(search.toLowerCase())
      )
    );

  return (
    <div className="email-list" style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      {profile && (
        <div style={{
          display: 'flex', alignItems: 'center', marginBottom: '20px', padding: '10px',
          backgroundColor: '#f0f0f0', borderRadius: '8px'
        }}>
          <img src={profile.picture} alt="avatar" style={{ borderRadius: '50%', width: 40, height: 40, marginRight: 12 }} />
          <div>
            <div><strong>{profile.name}</strong></div>
            <div style={{ fontSize: '0.9em', color: '#666' }}>{profile.email}</div>
          </div>
        </div>
      )}

      <input
        type="text"
        placeholder="🔍 Search all threads..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '10px', width: '100%', marginBottom: '20px', borderRadius: '8px', border: '1px solid #ccc' }}
      />

      <input
        type="text"
        placeholder="Add email to follow..."
        value={emailInput}
        onChange={(e) => setEmailInput(e.target.value)}
        style={{ padding: '10px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
      />
      <button
        onClick={handleAddEmail}
        style={{ padding: '10px', backgroundColor: '#2196f3', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
      >
        Add Email
      </button>

      {filteredThreads.length > 0 ? (
        filteredThreads.map((thread) => {
          const expanded = expandedThreadId === thread.id;
          const filteredMsgs = thread.messages.filter(msg =>
            msg.from.toLowerCase().includes(threadSearch.toLowerCase()) ||
            msg.body.toLowerCase().includes(threadSearch.toLowerCase())
          );

          let lastDateLabel = '';

          return (
            <div key={thread.id} className={`email-thread ${expanded ? 'expanded' : ''}`} style={{
              border: '2px solid #ccc', borderRadius: '10px', padding: '15px', marginBottom: '25px',
              backgroundColor: '#fafafa', boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
            }}>
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

                      const isMe = msg.from.includes(userEmail);

                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                          {showDateLabel && (
                            <div style={{
                              textAlign: 'center', margin: '15px 0 5px', color: '#666', fontSize: '0.85em', fontWeight: 'bold'
                            }}>
                              ── {dateLabel} ──
                            </div>
                          )}
                          <div className="message" style={{
                            display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignSelf: isMe ? 'flex-end' : 'flex-start',
                            maxWidth: '75%', backgroundColor: isMe ? '#dcf8c6' : '#fff', padding: '10px', borderRadius: '10px',
                            margin: '5px 0', border: isMe ? '1px solid #a2d5a2' : '1px solid #ccc',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)', textAlign: isMe ? 'right' : 'left'
                          }}>
                            <div className="avatar" style={{
                              backgroundColor: isMe ? '#4caf50' : '#888', color: '#fff', borderRadius: '50%',
                              width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 'bold', fontSize: '0.9em', margin: isMe ? '0 0 0 10px' : '0 10px 0 0'
                            }}>
                              {isMe ? 'You' : getInitials(msg.from)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 'bold' }}>{isMe ? 'You' : msg.from}</div>
                              <div className="email-body" style={{ marginTop: '6px', marginBottom: '8px' }}
                                dangerouslySetInnerHTML={{ __html: cleanBody(msg.body) }} />
                              <div style={{ fontSize: '0.8em', color: '#888' }}>{new Date(msg.date).toLocaleString()}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: '10px' }}>
                    {editor && (
                      <div style={{ marginBottom: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => editor.chain().focus().toggleBold().run()}
                          className={editor.isActive('bold') ? 'active' : ''}
                          title="Bold"
                          aria-label="Bold"
                          style={{ fontWeight: 'bold' }}
                        >
                          B
                        </button>
                        <button onClick={() => editor.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }}>I</button>
                        <button onClick={() => editor.chain().focus().toggleStrike().run()} style={{ textDecoration: 'line-through' }}>S</button>
                        <button onClick={() => editor.chain().focus().setParagraph().run()}>P</button>
                        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
                        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
                        <button onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
                        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
                        <button onClick={() => editor.chain().focus().undo().run()}>↺ Undo</button>
                        <button onClick={() => editor.chain().focus().redo().run()}>↻ Redo</button>
                      </div>
                    )}

                    <EditorContent 
                      editor={editor} 
                      className="tiptap-editor"
                    />

                    {/* Multi Attachment Upload */}
                    <div style={{ margin: '10px 0' }}>
                      <label style={{ fontSize: '0.9em', fontWeight: 'bold' }}>📎 Attach files:
                        <input 
                          type="file" 
                          multiple
                          onChange={(e) => {
                            const newFiles = Array.from(e.target.files || []);
                            setAttachments(prev => [...prev, ...newFiles]);
                          }} 
                          style={{ display: 'block', marginTop: '6px' }} 
                        />
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: '10px', gap: '10px' }}>
                        {attachments.map((file, index) => (
                          <div key={index} style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '4px 8px', background: '#f0f0f0' }}>
                            {file.name}
                            <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))} style={{ marginLeft: '8px', color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                      <button
                        onClick={() => sendReply(thread.id, thread.messages[0].from, thread.subject, false)}
                        style={{ padding: '8px 16px', backgroundColor: '#4caf50', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Send
                      </button>
                      <button
                        onClick={() => {
                          setPendingReplyMeta({
                            threadId: thread.id,
                            to: thread.messages[0].from,
                            subject: thread.subject,
                          });
                          setShowPreview(true);
                        }}
                        style={{ padding: '8px 16px', backgroundColor: '#2196f3', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <p>📨 Loading emails...</p>
      )}

      {showPreview && pendingReplyMeta && (
        <div style={{ position: 'fixed', top: 50, left: '10%', width: '80%', backgroundColor: 'white', border: '1px solid #ccc',
          padding: '20px', borderRadius: '10px', zIndex: 1000, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}>
          <h3>📨 Preview Your Reply</h3>
          <div dangerouslySetInnerHTML={{ __html: getReplyText() }} style={{ padding: '10px', border: '1px solid #eee' }} />
          <div style={{ marginTop: '10px', textAlign: 'right' }}>
            <button onClick={() => setShowPreview(false)} style={{ marginRight: '10px' }}>Cancel</button>
            <button onClick={() => {
              sendReply(pendingReplyMeta.threadId, pendingReplyMeta.to, pendingReplyMeta.subject, false);
              setShowPreview(false);
              setPendingReplyMeta(null);
            }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
