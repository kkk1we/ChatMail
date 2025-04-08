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

// Simple editor factory function to create multiple editors
function useCreateEditor() {
  return useEditor({
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
}

export default function EmailList({ token }) {
  const [profile, setProfile] = useState(null);
  const [threads, setThreads] = useState([]);
  const [search, setSearch] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [followEmails, setFollowEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [threadStates, setThreadStates] = useState({});
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [editors, setEditors] = useState({});

  // Initialize thread states when threads change
  useEffect(() => {
    const initialStates = {};
    threads.forEach(thread => {
      if (!threadStates[thread.id]) {
        initialStates[thread.id] = {
          expanded: false,
          threadSearch: '',
          showPreview: false,
          pendingReplyMeta: null,
          attachments: [],
          editor: null // Will be set when expanded
        };
      }
    });
    
    if (Object.keys(initialStates).length > 0) {
      setThreadStates(prev => ({...prev, ...initialStates}));
    }
  }, [threads]);

  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const res = await axios.post('http://localhost:5000/api/emails/followed', {
          senders: followEmails,
        }, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          withCredentials: true,
        });
        setThreads(res.data);
      } catch (error) {
        console.error('❌ Email fetch failed:', error.response?.data || error.message);
      }
    };

    if (followEmails.length > 0) {
      fetchEmails();
    }
  }, [followEmails, token]);
  
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
        setUserEmail(res.data.email);
      } catch (err) {
        console.error('❌ Failed to load profile:', err.message);
      }
    };

    fetchProfile();
  }, []);
  
  const toggleThread = (threadId) => {
    setThreadStates(prev => {
      const updatedState = {...prev};
      
      // If we're expanding a thread and no editor exists, create one
      if (!updatedState[threadId].expanded && !updatedState[threadId].editor) {
        // updatedState[threadId].editor = useCreateEditor();
      }
      
      updatedState[threadId] = {
        ...updatedState[threadId],
        expanded: !updatedState[threadId].expanded,
        threadSearch: '',
      };
      
      return updatedState;
    });
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
    const editor = threadStates[threadId]?.editor;
    if (!editor) return;
    
    const html = editor.getHTML();
    
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

      editor.commands.setContent('');
      
      // Reset thread state
      setThreadStates(prev => ({
        ...prev,
        [threadId]: {
          ...prev[threadId],
          showPreview: false,
          pendingReplyMeta: null,
          attachments: []
        }
      }));
      
    } catch (err) {
      console.error('❌ Reply failed:', err);
      alert('Failed to send reply.');
    }
  };
  
  const setThreadSearch = (threadId, value) => {
    setThreadStates(prev => ({
      ...prev,
      [threadId]: {
        ...prev[threadId],
        threadSearch: value
      }
    }));
  };
  
  const setAttachments = (threadId, newAttachments) => {
    setThreadStates(prev => ({
      ...prev,
      [threadId]: {
        ...prev[threadId],
        attachments: newAttachments
      }
    }));
  };
  
  const setPendingReplyMeta = (threadId, meta) => {
    setThreadStates(prev => ({
      ...prev,
      [threadId]: {
        ...prev[threadId],
        pendingReplyMeta: meta,
        showPreview: true
      }
    }));
  };
  
  const setShowPreview = (threadId, value) => {
    setThreadStates(prev => ({
      ...prev,
      [threadId]: {
        ...prev[threadId],
        showPreview: value
      }
    }));
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

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="🔍 Search all threads..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '10px', width: '100%', marginBottom: '10px', borderRadius: '8px', border: '1px solid #ccc' }}
        />

        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="Add email to follow..."
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            style={{ padding: '10px', flex: 1, borderRadius: '8px', border: '1px solid #ccc' }}
          />
          <button
            onClick={handleAddEmail}
            style={{ padding: '10px', backgroundColor: '#2196f3', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Add Email
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 'bold' }}>
            {followEmails.length > 0 ? `Following ${followEmails.length} email${followEmails.length > 1 ? 's' : ''}` : 'No emails followed yet'}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={() => setViewMode('grid')}
              style={{ 
                padding: '5px 10px', 
                backgroundColor: viewMode === 'grid' ? '#2196f3' : '#e0e0e0',
                color: viewMode === 'grid' ? 'white' : 'black',
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer' 
              }}
            >
              Grid View
            </button>
            <button 
              onClick={() => setViewMode('list')}
              style={{ 
                padding: '5px 10px', 
                backgroundColor: viewMode === 'list' ? '#2196f3' : '#e0e0e0',
                color: viewMode === 'list' ? 'white' : 'black',
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer' 
              }}
            >
              List View
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
          {followEmails.map((email, index) => (
            <div key={index} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              backgroundColor: '#e3f2fd', 
              borderRadius: '20px', 
              padding: '5px 10px',
              border: '1px solid #bbdefb'
            }}>
              <span>{email}</span>
              <button 
                onClick={() => setFollowEmails(prev => prev.filter((_, i) => i !== index))}
                style={{ 
                  marginLeft: '5px', 
                  background: 'none', 
                  border: 'none', 
                  cursor: 'pointer',
                  color: '#f44336',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {filteredThreads.length > 0 ? (
        <div style={viewMode === 'grid' ? { 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', 
          gap: '20px'
        } : {}}>
          {filteredThreads.map((thread) => {
            const threadState = threadStates[thread.id] || { 
              expanded: false, 
              threadSearch: '', 
              showPreview: false,
              pendingReplyMeta: null,
              attachments: [],
              editor: null
            };
            
            const expanded = threadState.expanded;
            const threadSearch = threadState.threadSearch || '';
            const attachments = threadState.attachments || [];
            const editor = threadState.editor;
            
            const filteredMsgs = thread.messages.filter(msg =>
              msg.from.toLowerCase().includes(threadSearch.toLowerCase()) ||
              msg.body.toLowerCase().includes(threadSearch.toLowerCase())
            );

            let lastDateLabel = '';

            return (
              <div key={thread.id} className={`email-thread ${expanded ? 'expanded' : ''}`} style={{
                border: '2px solid #ccc', 
                borderRadius: '10px', 
                padding: '15px', 
                marginBottom: viewMode === 'list' ? '25px' : '0',
                backgroundColor: '#fafafa', 
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                borderTop: '5px solid #2196f3', // Visual accent
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  cursor: 'pointer'
                }} onClick={() => toggleThread(thread.id)}>
                  <h3 style={{ margin: '0 0 5px 0', color: '#333', flex: 1 }}>
                    📬 {thread.subject || '(no subject)'}
                  </h3>
                  <span style={{ 
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0)', 
                    transition: 'transform 0.3s',
                    fontSize: '1.2em'
                  }}>▼</span>
                </div>
                
                <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '10px' }}>
                  {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''} • 
                  Last activity: {new Date(thread.messages[thread.messages.length - 1].date).toLocaleString()}
                </div>

                {expanded && (
                  <div style={{ marginTop: '15px' }}>
                    <input
                      type="text"
                      placeholder="Search in this thread..."
                      value={threadSearch}
                      onChange={(e) => setThreadSearch(thread.id, e.target.value)}
                      style={{ padding: '8px', width: '100%', marginBottom: '15px', borderRadius: '6px', border: '1px solid #aaa' }}
                    />

                    <div style={{ 
                      maxHeight: '400px', 
                      overflowY: 'auto', 
                      paddingRight: '10px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      padding: '10px',
                      backgroundColor: '#f5f5f5'
                    }}>
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
                            <div className={`message ${isMe ? 'sent' : 'received'}`} style={{
                              display: 'flex', 
                              flexDirection: isMe ? 'row-reverse' : 'row', 
                              alignSelf: isMe ? 'flex-end' : 'flex-start',
                              maxWidth: '75%', 
                              backgroundColor: isMe ? '#dcf8c6' : '#fff', 
                              padding: '10px', 
                              borderRadius: '10px',
                              margin: '5px 0', 
                              border: isMe ? '1px solid #a2d5a2' : '1px solid #ccc',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.05)', 
                              textAlign: isMe ? 'right' : 'left'
                            }}>
                              <div className="avatar" style={{
                                backgroundColor: isMe ? '#4caf50' : '#888', 
                                color: '#fff', 
                                borderRadius: '50%',
                                width: '36px', 
                                height: '36px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                fontWeight: 'bold', 
                                fontSize: '0.9em', 
                                margin: isMe ? '0 0 0 10px' : '0 10px 0 0'
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

                    <div style={{ marginTop: '15px', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px' }}>
                      <h4 style={{ margin: '0 0 10px 0' }}>Reply</h4>
                      {editor && (
                        <div style={{ marginBottom: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            className={editor.isActive('bold') ? 'active' : ''}
                            title="Bold"
                            aria-label="Bold"
                            style={{ 
                              fontWeight: 'bold', 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('bold') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            B
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleItalic().run()} 
                            style={{ 
                              fontStyle: 'italic',
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('italic') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            I
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleStrike().run()} 
                            style={{ 
                              textDecoration: 'line-through',
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('strike') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            S
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().setParagraph().run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('paragraph') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            P
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('heading', { level: 1 }) ? '#e3f2fd' : '#fff'
                            }}
                          >
                            H1
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('heading', { level: 2 }) ? '#e3f2fd' : '#fff'
                            }}
                          >
                            H2
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('bulletList') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            • List
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc',
                              backgroundColor: editor.isActive('orderedList') ? '#e3f2fd' : '#fff'
                            }}
                          >
                            1. List
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().undo().run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc'
                            }}
                          >
                            ↺ Undo
                          </button>
                          <button 
                            onClick={() => editor.chain().focus().redo().run()}
                            style={{ 
                              padding: '5px 10px',
                              borderRadius: '4px',
                              border: '1px solid #ccc'
                            }}
                          >
                            ↻ Redo
                          </button>
                        </div>
                      )}

                      {editor && (
                        <EditorContent 
                          editor={editor} 
                          className="tiptap-editor"
                          style={{
                            border: '1px solid #ccc',
                            borderRadius: '6px',
                            minHeight: '150px',
                            padding: '10px',
                            marginBottom: '10px'
                          }}
                        />
                      )}

                      {/* Multi Attachment Upload */}
                      <div style={{ margin: '10px 0' }}>
                        <label style={{ fontSize: '0.9em', fontWeight: 'bold' }}>📎 Attach files:
                          <input 
                            type="file" 
                            multiple
                            onChange={(e) => {
                              const newFiles = Array.from(e.target.files || []);
                              setAttachments(thread.id, [...attachments, ...newFiles]);
                            }} 
                            style={{ display: 'block', marginTop: '6px' }} 
                          />
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: '10px', gap: '10px' }}>
                          {attachments.map((file, index) => (
                            <div key={index} style={{ 
                              border: '1px solid #ccc', 
                              borderRadius: '4px', 
                              padding: '4px 8px', 
                              background: '#f0f0f0',
                              display: 'flex',
                              alignItems: 'center'
                            }}>
                              <span style={{ marginRight: '5px' }}>📄</span>
                              {file.name}
                              <button 
                                onClick={() => setAttachments(thread.id, attachments.filter((_, i) => i !== index))} 
                                style={{ 
                                  marginLeft: '8px', 
                                  color: 'red', 
                                  background: 'none', 
                                  border: 'none', 
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  fontWeight: 'bold'
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                        <button
                          onClick={() => sendReply(thread.id, thread.messages[0].from, thread.subject, false)}
                          style={{ 
                            padding: '8px 16px', 
                            backgroundColor: '#4caf50', 
                            color: '#fff', 
                            border: 'none', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <span style={{ fontSize: '1.2em' }}>✉️</span>
                          Send Reply
                        </button>
                        <button
                          onClick={() => {
                            setPendingReplyMeta(thread.id, {
                              threadId: thread.id,
                              to: thread.messages[0].from,
                              subject: thread.subject,
                            });
                          }}
                          style={{ 
                            padding: '8px 16px', 
                            backgroundColor: '#2196f3', 
                            color: '#fff', 
                            border: 'none', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <span style={{ fontSize: '1.2em' }}>👁️</span>
                          Preview
                        </button>
                        <button
                          onClick={() => sendReply(thread.id, thread.messages[0].from, thread.subject, true)}
                          style={{ 
                            padding: '8px 16px', 
                            backgroundColor: '#ff9800', 
                            color: '#fff', 
                            border: 'none', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <span style={{ fontSize: '1.2em' }}>💾</span>
                          Save Draft
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {threadState.showPreview && threadState.pendingReplyMeta && (
                  <div style={{ 
                    position: 'fixed', 
                    top: 0, 
                    left: 0, 
                    width: '100%', 
                    height: '100%', 
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1000
                  }}>
                    <div style={{ 
                      backgroundColor: 'white', 
                      border: '1px solid #ccc',
                      padding: '20px', 
                      borderRadius: '10px', 
                      boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                      width: '80%',
                      maxWidth: '800px',
                      maxHeight: '80vh',
                      overflow: 'auto'
                    }}>
                      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '10px' }}>📨 Preview Your Reply</h3>
                      <div style={{ margin: '15px 0' }}>
                        <div style={{ marginBottom: '5px' }}><strong>To:</strong> {threadState.pendingReplyMeta.to}</div>
                        <div style={{ marginBottom: '5px' }}><strong>Subject:</strong> {threadState.pendingReplyMeta.subject}</div>
                      </div>
                      <div style={{ 
                        padding: '15px', 
                        border: '1px solid #eee',
                        borderRadius: '6px',
                        backgroundColor: '#fafafa' 
                      }} dangerouslySetInnerHTML={{ __html: editor ? editor.getHTML() : '' }} />
                      
                      {attachments.length > 0 && (
                        <div style={{ marginTop: '15px' }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Attachments:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {attachments.map((file, index) => (
                              <div key={index} style={{ 
                                padding: '5px 10px', 
                                backgroundColor: '#f0f0f0', 
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                              }}>
                                <span role="img" aria-label="file">📄</span> {file.name}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button 
                          onClick={() => setShowPreview(thread.id, false)} 
                          style={{ 
                            padding: '8px 16px', 
                            backgroundColor: '#e0e0e0', 
                            border: 'none', 
                            borderRadius: '6px', 
                            cursor: 'pointer' 
                          }}
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => {
                            sendReply(threadState.pendingReplyMeta.threadId, threadState.pendingReplyMeta.to, threadState.pendingReplyMeta.subject, false);
                            setShowPreview(thread.id, false);
                          }} 
                          style={{ 
                            padding: '8px 16px', 
                            backgroundColor: '#4caf50', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '6px', 
                            cursor: 'pointer' 
                          }}
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          backgroundColor: '#f5f5f5', 
          borderRadius: '10px',
          border: '1px dashed #ccc'
        }}>
          {followEmails.length > 0 ? (
            <p>📨 Loading emails...</p>
          ) : (
            <p>📭 No emails to show. Add an email address to follow above.</p>
          )}
        </div>
      )}
    </div>
  );
}