from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List
from ..database import get_db
from ..models import User, Contact
from ..schemas import ContactResponse, ContactCreate, UserResponse
from ..auth import get_current_user

router = APIRouter(prefix="/contacts", tags=["contacts"])

@router.get("/", response_model=List[UserResponse])
def get_contacts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retrieve all contacts for the current user."""
    contacts = db.query(Contact).filter(Contact.user_id == current_user.id).all()
    # Return User objects of contacts
    contact_users = [c.contact for c in contacts]
    return contact_users

@router.post("/", response_model=UserResponse)
def add_contact(
    contact_data: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a new contact by phone number."""
    # Find user by phone
    contact_user = db.query(User).filter(User.phone == contact_data.contact_phone).first()
    if not contact_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User with this phone number not found"
        )
    
    if contact_user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot add yourself as a contact"
        )
    
    # Check if contact already exists
    existing = db.query(Contact).filter(
        Contact.user_id == current_user.id,
        Contact.contact_user_id == contact_user.id
    ).first()
    
    if existing:
        return contact_user

    # Add contact (bidirectional for convenience in messaging app)
    contact_link_1 = Contact(user_id=current_user.id, contact_user_id=contact_user.id)
    contact_link_2 = Contact(user_id=contact_user.id, contact_user_id=current_user.id)
    
    db.add(contact_link_1)
    db.add(contact_link_2)
    db.commit()
    
    return contact_user
