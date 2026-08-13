from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime
from typing import List
from ..database import get_db
from ..models import User, Contact
from ..schemas import UserResponse, UserBase
from ..auth import get_current_user

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get currently authenticated user's profile."""
    return current_user

@router.put("/me", response_model=UserResponse)
def update_me(
    profile_data: UserBase, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """Update profile details (name, avatar)."""
    if profile_data.display_name:
        current_user.display_name = profile_data.display_name
    if profile_data.avatar:
        current_user.avatar = profile_data.avatar
    
    db.commit()
    db.refresh(current_user)
    return current_user

@router.get("/search", response_model=List[UserResponse])
def search_users(
    q: str, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """Search registered users by phone or display name (excluding self)."""
    if len(q) < 2:
        return []
    
    users = db.query(User).filter(
        User.id != current_user.id,
        or_(
            User.phone.contains(q),
            User.display_name.contains(q)
        )
    ).limit(20).all()
    
    return users
