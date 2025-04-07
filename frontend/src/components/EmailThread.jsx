import React from 'react';
import { format } from 'date-fns';

export default function EmailThread({ thread }) {
  return (
    <div className="thread-view">
      <h3>{thread.subject}</h3>
      {thread.messages.map((msg, i) => (
        <div key={i} className={`message ${msg.isMe ? 'sent' : 'received'}`}>
          <div className="sender">{msg.from}</div>
          <div className="content">{msg.body}</div>
          <div className="timestamp">
            {format(new Date(msg.date), 'MMM dd, yyyy h:mm a')}
          </div>
        </div>
      ))}
    </div>
  );
}