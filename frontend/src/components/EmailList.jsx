import React, { useEffect, useState } from 'react';
import axios from 'axios';
import EmailEditor from './EmailEditor';
import './EmailList.css';

// Helper functions
const cleanBody = (html) => {
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
};

const getDateLabel = (dateStr) => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'long' });
};

const getInitials = (from) => {
  const name = from.split('<')[0].trim();
  return name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
};

// Extract primary email from a sender string (handles formats like "Name <email@example.com>")
const extractEmail = (from) => {
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  return emailMatch ? emailMatch[1] : from;
};

// Get a preview of the thread content (first few words)
const getThreadPreview = (thread) => {
  if (!thread.messages || thread.messages.length === 0) return '';
  const lastMessage = thread.messages[thread.messages.length - 1];
  const cleanedBody = cleanBody(lastMessage.body);
  const textOnly = cleanedBody.replace(/<[^>]+>/g, ' ').trim();
  return textOnly.length > 60 ? textOnly.substring(0, 60) + '...' : textOnly;
};

export default function EmailList({ token }) {
  const [profile, setProfile] = useState(null);
  const [threads, setThreads] = useState([]);
  const [search, setSearch] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [followEmails, setFollowEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [emailGroups, setEmailGroups] = useState({});
  const [viewMode, setViewMode] = useState('grid');
  
  // Thread-specific state
  const [expandedThreads, setExpandedThreads] = useState({});
  const [threadSearches, setThreadSearches] = useState({});
  const [pendingReplies, setPendingReplies] = useState({});
  const [attachments, setAttachments] = useState({});
  const [showPreviews, setShowPreviews] = useState({});
  const [editorContents, setEditorContents] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const [followFromEmails, setFollowFromEmails] = useState([]);
  const [followToEmails, setFollowToEmails] = useState([]);
  const [emailInputFrom, setEmailInputFrom] = useState('');
  const [emailInputTo, setEmailInputTo] = useState('');
  const [activeTab, setActiveTab] = useState('from'); // 'from' or 'to'

  // Fetch profile data
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
  const fetchFollowedEmails = async (emailsToFetch = followEmails) => {
    try {
      // First ensure we have the latest list of followed emails
      const res = await axios.get('http://localhost:5000/api/followed-emails', {
        withCredentials: true,
      });
      if (res.data && Array.isArray(res.data.followedEmails)) {
        setFollowEmails(res.data.followedEmails);
      }
      
      // Then fetch the actual email content for these addresses
      setIsLoading(true); // Add this state variable to track loading state
      
      // Fetch email threads for the followed emails
      const threadsRes = await axios.post('http://localhost:5000/api/email-threads', {
        emails: emailsToFetch
      }, {
        withCredentials: true,
      });
      
      if (threadsRes.data && threadsRes.data.threads) {
        // Group emails by sender
        const groupedThreads = {};
        threadsRes.data.threads.forEach(thread => {
          // Assuming the first message's from field contains the sender
          const sender = thread.messages[0].from;
          if (!groupedThreads[sender]) {
            groupedThreads[sender] = [];
          }
          groupedThreads[sender].push(thread);
        });
        
        setEmailGroups(groupedThreads);
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to fetch emails:', error);
      setIsLoading(false);
    }
  };
  // Fetch emails for followed addresses
  useEffect(() => {
    fetchFollowedEmails();
  }, []);
  
  // Update handleAddEmail to save to database
  const handleAddEmail = () => {
    if (emailInput && !followEmails.includes(emailInput)) {
      const newFollowEmails = [...followEmails, emailInput];
      setFollowEmails(newFollowEmails);
      setEmailInput('');
      
      // Save to backend
      axios.post('http://localhost:5000/api/follow-email', {
        email: emailInput
      }, {
        withCredentials: true,
      })
      .then(() => {
        // Fetch emails for the newly added email address
        fetchFollowedEmails(newFollowEmails);
      })
      .catch(error => {
        console.error('Failed to add email to follow:', error);
      });
    }
  };
  
  
  // Update the remove function as well
  const removeFollowedEmail = async (indexToRemove) => {
    try {
      const updatedEmails = followEmails.filter((_, i) => i !== indexToRemove);
      
      await axios.post('http://localhost:5000/api/followed-emails', {
        emails: updatedEmails
      }, {
        withCredentials: true
      });
      
      setFollowEmails(updatedEmails);
    } catch (error) {
      console.error('Failed to remove followed email:', error);
      alert('Failed to remove email from follow list');
    }
  };
  
  // Toggle thread expansion
  const toggleThread = (threadId) => {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId]
    }));
  };

  // Update thread search
  const updateThreadSearch = (threadId, value) => {
    setThreadSearches(prev => ({
      ...prev,
      [threadId]: value
    }));
  };

  // Add/remove attachments
  const updateAttachments = (threadId, newAttachments) => {
    setAttachments(prev => ({
      ...prev,
      [threadId]: newAttachments
    }));
  };

  // Set pending reply metadata
  const setPendingReplyMeta = (threadId, meta) => {
    setPendingReplies(prev => ({
      ...prev,
      [threadId]: meta
    }));
    setShowPreviews(prev => ({
      ...prev,
      [threadId]: true
    }));
  };

  // Toggle preview visibility
  const togglePreview = (threadId, value) => {
    setShowPreviews(prev => ({
      ...prev,
      [threadId]: value
    }));
  };

  // Update editor content
  const updateEditorContent = (threadId, content) => {
    setEditorContents(prev => ({
      ...prev,
      [threadId]: content
    }));
  };

  // Send or save reply
 // Send or save reply
// Update the sendReply function in your EmailList.jsx
const sendReply = async (threadId, to, subject, isDraft) => {
  const html = editorContents[threadId] || '';
  if (!html) return;
  
  try {
    // Format the recipient correctly if needed
    const recipient = to.includes('<') ? to : `<${to}>`;
    
    await axios.post('http://localhost:5000/api/reply', {
      // Skip threadId if it's not a valid Gmail thread ID
      // threadId: threadId, 
      to: recipient,
      subject: `Re: ${subject}`,
      message: html,
      draft: isDraft
    }, { 
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add reply to local thread
    setThreads(prev =>
      prev.map(thread => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: `local-${Date.now()}`,
              from: userEmail,
              subject,
              date: new Date().toISOString(),
              body: html,
            }
          ],
        };
      })
    );

    // Show success message
    alert(isDraft ? '✅ Draft saved!' : '✅ Reply sent!');

    // Reset editor content
    updateEditorContent(threadId, '');
    
    // Reset preview state
    togglePreview(threadId, false);
    
    // Clear attachments
    updateAttachments(threadId, []);
    
  } catch (err) {
    console.error('❌ Reply failed:', err.response?.data || err.message);
    alert(`Failed to send reply: ${err.response?.data?.error || err.message}`);
  }
};

  // Group threads by sender email
  const groupThreadsBySender = () => {
    const groupedThreads = {};
    
    threads.forEach(thread => {
      if (!thread.messages || thread.messages.length === 0) return;
      
      // Get the sender of the first message
      const firstMessage = thread.messages[0];
      const sender = extractEmail(firstMessage.from);
      
      if (!groupedThreads[sender]) {
        groupedThreads[sender] = [];
      }
      
      groupedThreads[sender].push(thread);
    });
    
    return groupedThreads;
  };

  // Filter threads based on search
  const filteredThreads = threads.filter(thread =>
    thread.subject?.toLowerCase().includes(search.toLowerCase()) ||
    thread.messages?.some(msg =>
      msg.from?.toLowerCase().includes(search.toLowerCase()) ||
      msg.body?.toLowerCase().includes(search.toLowerCase())
    )
  );

  // Group threads by sender
  const groupedThreads = groupThreadsBySender();

  return (
    <div className="email-list">
      {/* Profile Section */}
      {profile && (
        <div className="profile-container">
          <img src={profile.picture} alt="avatar" className="profile-image" />
          <div>
            <div><strong>{profile.name}</strong></div>
            <div className="profile-email">{profile.email}</div>
          </div>
        </div>
      )}
  
      {/* Search and Email Management */}
      <div className="search-section">
        <input
          type="text"
          placeholder="🔍 Search all threads..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
  
        <div className="email-input-container">
          <input
            type="text"
            placeholder="Add email to follow..."
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="email-input"
          />
          <button
            onClick={handleAddEmail}
            className="add-button"
          >
            Add Email
          </button>
        </div>
  
        <div className="follow-header">
          <div className="follow-count">
            {followEmails.length > 0 ? 
              `Following ${followEmails.length} email${followEmails.length > 1 ? 's' : ''}` : 
              'No emails followed yet'}
          </div>
          <div className="view-buttons">
            <button 
              onClick={() => setViewMode('grid')}
              className={`view-button ${viewMode === 'grid' ? 'active' : ''}`}
            >
              Grid View
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`view-button ${viewMode === 'list' ? 'active' : ''}`}
            >
              List View
            </button>
          </div>
        </div>
  
        <div className="email-chips">
          {followEmails.map((email, index) => (
            <div key={index} className="email-chip">
              <span>{email}</span>
              <button 
                onClick={() => removeFollowedEmail(index)}
                className="remove-button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
  
      {/* Email Threads Grouped by Sender */}
      {Object.keys(emailGroups).length > 0 ? (
        <div className="email-groups">
          {Object.entries(emailGroups).map(([sender, senderThreads]) => (
            <div key={sender} className="email-group">
              <h2 className="sender-email">{sender}</h2>
              
              <div className={viewMode === 'grid' ? 'grid-container' : 'list-container'}>
                {senderThreads.map((thread) => {
                  const isExpanded = expandedThreads[thread.id] || false;
                  const threadSearch = threadSearches[thread.id] || '';
                  const threadAttachments = attachments[thread.id] || [];
                  
                  const filteredMsgs = thread.messages.filter(msg =>
                    msg.from.toLowerCase().includes(threadSearch.toLowerCase()) ||
                    msg.body.toLowerCase().includes(threadSearch.toLowerCase())
                  );
  
                  let lastDateLabel = '';
                  const threadPreview = getThreadPreview(thread);
  
                  return (
                    <div key={thread.id} className={`email-thread ${isExpanded ? 'expanded' : ''}`}>
                      <div className="thread-header" onClick={() => toggleThread(thread.id)}>
                        <h3 className="thread-title">
                          📬 {thread.subject || '(no subject)'}
                        </h3>
                        <div className="thread-preview">{threadPreview}</div>
                        <span className={`thread-toggle ${isExpanded ? 'expanded' : ''}`}>▼</span>
                      </div>
                      
                      <div className="thread-info">
                        {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''} • 
                        Last activity: {new Date(thread.messages[thread.messages.length - 1].date).toLocaleString()}
                      </div>

                      {isExpanded && (
                        <div className="thread-expanded">
                          <input
                            type="text"
                            placeholder="Search in this thread..."
                            value={threadSearch}
                            onChange={(e) => updateThreadSearch(thread.id, e.target.value)}
                            className="thread-search"
                          />

                          <div className="messages-container">
                            {filteredMsgs.map((msg, i) => {
                              const dateLabel = getDateLabel(msg.date);
                              const showDateLabel = dateLabel !== lastDateLabel;
                              lastDateLabel = dateLabel;

                              const isMe = msg.from.includes(userEmail);

                              return (
                                <div key={i} className="message-wrapper">
                                  {showDateLabel && (
                                    <div className="date-label">
                                      ── {dateLabel} ──
                                    </div>
                                  )}
                                  <div className={`message ${isMe ? 'sent' : 'received'}`}>
                                    <div className={`avatar ${isMe ? 'me' : ''}`}>
                                      {isMe ? 'You' : getInitials(msg.from)}
                                    </div>
                                    <div className="message-content">
                                      <div className="message-sender">{isMe ? 'You' : msg.from}</div>
                                      <div className="message-body"
                                        dangerouslySetInnerHTML={{ __html: cleanBody(msg.body) }} />
                                      <div className="message-time">{new Date(msg.date).toLocaleString()}</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="reply-container">
                            <h4 className="reply-title">Reply</h4>
                            
                            {/* For each thread, we render a separate EmailEditor component */}
                            <EmailEditor
                              threadId={thread.id}
                              value={editorContents[thread.id] || ''}
                              onChange={(html) => updateEditorContent(thread.id, html)}
                            />

                            <div className="attachment-section">
                              <label className="attachment-label">📎 Attach files:
                                <input 
                                  type="file" 
                                  multiple
                                  onChange={(e) => {
                                    const newFiles = Array.from(e.target.files || []);
                                    updateAttachments(thread.id, [...threadAttachments, ...newFiles]);
                                  }} 
                                  className="file-input"
                                />
                              </label>
                              <div className="attachment-list">
                                {threadAttachments.map((file, index) => (
                                  <div key={index} className="attachment-item">
                                    <span className="file-icon">📄</span>
                                    {file.name}
                                    <button 
                                      onClick={() => updateAttachments(thread.id, threadAttachments.filter((_, i) => i !== index))} 
                                      className="remove-button"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            <div className="button-group">
                              <button
                                onClick={() => sendReply(thread.id, thread.messages[0].from, thread.subject, false)}
                                className="action-button send"
                              >
                                <span className="button-icon">✉️</span>
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
                                className="action-button preview"
                              >
                                <span className="button-icon">👁️</span>
                                Preview
                              </button>
                              <button
                                onClick={() => sendReply(thread.id, thread.messages[0].from, thread.subject, true)}
                                className="action-button draft"
                              >
                                <span className="button-icon">💾</span>
                                Save Draft
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Preview Modal */}
                      {showPreviews[thread.id] && pendingReplies[thread.id] && (
                        <div className="preview-modal">
                          <div className="preview-card">
                            <h3 className="preview-title">📨 Preview Your Reply</h3>
                            <div className="preview-meta">
                              <div className="preview-meta-item"><strong>To:</strong> {pendingReplies[thread.id].to}</div>
                              <div className="preview-meta-item"><strong>Subject:</strong> {pendingReplies[thread.id].subject}</div>
                            </div>
                            <div className="preview-content" 
                              dangerouslySetInnerHTML={{ __html: editorContents[thread.id] || '' }} />
                            
                            {threadAttachments.length > 0 && (
                              <div className="preview-attachments">
                                <div className="attachments-title">Attachments:</div>
                                <div className="attachment-list">
                                  {threadAttachments.map((file, index) => (
                                    <div key={index} className="attachment-item">
                                      <span role="img" aria-label="file">📄</span> {file.name}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            <div className="preview-actions">
                              <button 
                                onClick={() => togglePreview(thread.id, false)} 
                                className="cancel-button"
                              >
                                Cancel
                              </button>
                              <button 
                                onClick={() => {
                                  sendReply(pendingReplies[thread.id].threadId, pendingReplies[thread.id].to, pendingReplies[thread.id].subject, false);
                                  togglePreview(thread.id, false);
                                }} 
                                className="send-button"
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
            </div>
          ))}
        </div>
      ) : (
        <div className="no-emails">
        {followEmails.length > 0 ? (
          <div className="loading-state">
            <p>📨 {isLoading ? 'Loading emails...' : 'No emails found for the followed addresses.'}</p>
            <button 
              onClick={() => fetchFollowedEmails()} 
              className="refresh-button"
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Refresh Emails'}
            </button>
          </div>
        ) : (
          <p>📭 No emails to show. Add an email address to follow above.</p>
        )}
      </div>
      )}
    </div>
  );
}