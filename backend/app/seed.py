from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import random

from .database import SessionLocal, engine, Base
from .models import User, Contact, Conversation, ConversationMember, Message, MessageStatus, Reaction

def seed_database():
    db = SessionLocal()
    
    # Clean database first
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    print("Seeding database...")
    
    # 1. Create Users
    users_data = [
        {"phone": "+12065550100", "display_name": "Alice Smith", "avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice"},
        {"phone": "+12065550101", "display_name": "Bob Jones", "avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob"},
        {"phone": "+12065550102", "display_name": "Charlie Brown", "avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie"},
        {"phone": "+12065550103", "display_name": "Diana Prince", "avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=Diana"},
    ]
    
    users = []
    for u_data in users_data:
        user = User(
            phone=u_data["phone"],
            display_name=u_data["display_name"],
            avatar=u_data["avatar"],
            is_online=False,
            last_seen=datetime.utcnow() - timedelta(minutes=random.randint(10, 120))
        )
        db.add(user)
        users.append(user)
    
    db.commit()
    for u in users:
        db.refresh(u)
        
    alice, bob, charlie, diana = users[0], users[1], users[2], users[3]
    
    # 2. Add Contacts (Bidirectional)
    contacts_pairs = [
        (alice, bob),
        (alice, charlie),
        (alice, diana),
        (bob, charlie),
        (charlie, diana)
    ]
    
    for u1, u2 in contacts_pairs:
        c1 = Contact(user_id=u1.id, contact_user_id=u2.id)
        c2 = Contact(user_id=u2.id, contact_user_id=u1.id)
        db.add(c1)
        db.add(c2)
    db.commit()
    
    # 3. Create Conversations
    # 3.1 1-on-1 Alice & Bob
    conv_alice_bob = Conversation(is_group=False, created_by=alice.id)
    # 3.2 1-on-1 Alice & Charlie
    conv_alice_charlie = Conversation(is_group=False, created_by=alice.id)
    # 3.3 Group "Project Devs" (Alice, Bob, Charlie)
    conv_devs = Conversation(
        name="Project Devs", 
        is_group=True, 
        avatar="https://api.dicebear.com/7.x/initials/svg?seed=PD", 
        created_by=alice.id
    )
    # 3.4 Group "Weekend Plans" (Alice, Charlie, Diana)
    conv_weekend = Conversation(
        name="Weekend Plans", 
        is_group=True, 
        avatar="https://api.dicebear.com/7.x/initials/svg?seed=WP", 
        created_by=charlie.id
    )
    
    db.add_all([conv_alice_bob, conv_alice_charlie, conv_devs, conv_weekend])
    db.commit()
    db.refresh(conv_alice_bob)
    db.refresh(conv_alice_charlie)
    db.refresh(conv_devs)
    db.refresh(conv_weekend)
    
    # 4. Add Conversation Members
    # 4.1 Alice & Bob
    db.add_all([
        ConversationMember(conversation_id=conv_alice_bob.id, user_id=alice.id, is_admin=False),
        ConversationMember(conversation_id=conv_alice_bob.id, user_id=bob.id, is_admin=False)
    ])
    # 4.2 Alice & Charlie
    db.add_all([
        ConversationMember(conversation_id=conv_alice_charlie.id, user_id=alice.id, is_admin=False),
        ConversationMember(conversation_id=conv_alice_charlie.id, user_id=charlie.id, is_admin=False)
    ])
    # 4.3 Project Devs (Alice is admin)
    db.add_all([
        ConversationMember(conversation_id=conv_devs.id, user_id=alice.id, is_admin=True),
        ConversationMember(conversation_id=conv_devs.id, user_id=bob.id, is_admin=False),
        ConversationMember(conversation_id=conv_devs.id, user_id=charlie.id, is_admin=False)
    ])
    # 4.4 Weekend Plans (Charlie is admin)
    db.add_all([
        ConversationMember(conversation_id=conv_weekend.id, user_id=alice.id, is_admin=False),
        ConversationMember(conversation_id=conv_weekend.id, user_id=charlie.id, is_admin=True),
        ConversationMember(conversation_id=conv_weekend.id, user_id=diana.id, is_admin=False)
    ])
    db.commit()
    
    # Helper to add a message with read statuses
    def add_message(conv_id, sender, content, time_offset_mins, reply_to=None, type="text", disappear=None):
        time = datetime.utcnow() - timedelta(minutes=time_offset_mins)
        msg = Message(
            conversation_id=conv_id,
            sender_id=sender.id,
            content=content,
            message_type=type,
            reply_to_id=reply_to,
            disappear_after=disappear,
            created_at=time
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        
        # Add statuses for all members
        members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv_id).all()
        for m in members:
            # Sender has read status
            status_val = "read" if m.user_id == sender.id else "read"  # Make history read by default
            status_obj = MessageStatus(
                message_id=msg.id,
                user_id=m.user_id,
                status=status_val,
                updated_at=time
            )
            db.add(status_obj)
        db.commit()
        db.refresh(msg)
        return msg

    # 5. Populate Alice & Bob Chat
    m1 = add_message(conv_alice_bob.id, alice, "Hi Bob, are we still on for the sync later today?", 60)
    m2 = add_message(conv_alice_bob.id, bob, "Hey Alice! Yes, absolutely. Does 4 PM work?", 50)
    m3 = add_message(conv_alice_bob.id, alice, "Perfect, see you at 4 PM.", 45)
    
    # 6. Populate Alice & Charlie Chat
    m4 = add_message(conv_alice_charlie.id, charlie, "Hi Alice, could you check the layout draft I sent?", 120)
    m5 = add_message(conv_alice_charlie.id, alice, "Sure! Let me look at it now.", 115)
    
    # Make a newer message that is unread by Alice
    m6 = Message(
        conversation_id=conv_alice_charlie.id,
        sender_id=charlie.id,
        content="Let me know if we need to adjust the color schemes too.",
        message_type="text",
        created_at=datetime.utcnow() - timedelta(minutes=10)
    )
    db.add(m6)
    db.commit()
    db.refresh(m6)
    # Alice hasn't read it
    db.add(MessageStatus(message_id=m6.id, user_id=charlie.id, status="read"))
    db.add(MessageStatus(message_id=m6.id, user_id=alice.id, status="delivered"))
    db.commit()

    # 7. Populate Project Devs Chat
    md1 = add_message(conv_devs.id, alice, "Welcome to the Project Devs room!", 180)
    md2 = add_message(conv_devs.id, bob, "Hey everyone! Glad to be here.", 175)
    md3 = add_message(conv_devs.id, charlie, "Let's code this messaging platform!", 170)
    
    # Add reaction to md3
    react1 = Reaction(message_id=md3.id, user_id=alice.id, emoji="👍")
    react2 = Reaction(message_id=md3.id, user_id=bob.id, emoji="🚀")
    db.add_all([react1, react2])
    db.commit()

    # Add a quoted message reply
    md4 = add_message(conv_devs.id, alice, "Awesome. Charlie, can you take the lead on frontend?", 160, reply_to=md3.id)

    # 8. Populate Weekend Plans Chat
    mw1 = add_message(conv_weekend.id, charlie, "Hey girls, any plans for this Saturday?", 240)
    mw2 = add_message(conv_weekend.id, diana, "I'm down for a hike or brunch!", 230)
    mw3 = add_message(conv_weekend.id, alice, "Brunch sounds delicious! Let's do that.", 220)

    # Add disappearing message test
    # 10 seconds disappear message
    md_disp = add_message(conv_devs.id, bob, "This message will self destruct in 10 seconds when read!", 5, disappear=10)
    
    db.close()
    print("Database seeding completed!")

if __name__ == "__main__":
    seed_database()
