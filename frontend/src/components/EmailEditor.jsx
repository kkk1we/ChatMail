// EmailEditor.jsx
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

function EmailEditor({ threadId, value, onChange }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editorProps: {
      handleKeyDown(view, event) {
        if (event.key === 'Tab') {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText('    '));
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    }
  });

  // If value changes externally, update editor content
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className="editor-container">
      <div className="toolbar-container">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`toolbar-button ${editor.isActive('bold') ? 'active' : ''}`}
          title="Bold"
          aria-label="Bold"
        >
          B
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleItalic().run()} 
          className={`toolbar-button ${editor.isActive('italic') ? 'active' : ''}`}
        >
          I
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleStrike().run()} 
          className={`toolbar-button ${editor.isActive('strike') ? 'active' : ''}`}
        >
          S
        </button>
        <button 
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={`toolbar-button ${editor.isActive('paragraph') ? 'active' : ''}`}
        >
          P
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`toolbar-button ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
        >
          H1
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`toolbar-button ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
        >
          H2
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`toolbar-button ${editor.isActive('bulletList') ? 'active' : ''}`}
        >
          • List
        </button>
        <button 
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`toolbar-button ${editor.isActive('orderedList') ? 'active' : ''}`}
        >
          1. List
        </button>
        <button 
          onClick={() => editor.chain().focus().undo().run()}
          className="toolbar-button"
        >
          ↺ Undo
        </button>
        <button 
          onClick={() => editor.chain().focus().redo().run()}
          className="toolbar-button"
        >
          ↻ Redo
        </button>
      </div>

      <EditorContent 
        editor={editor} 
        className="tiptap-editor"
      />
    </div>
  );
}

export default EmailEditor;