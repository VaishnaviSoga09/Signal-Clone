from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from ..database import get_db
from ..models import User
from ..schemas import UserLogin, UserVerifyOTP, UserCreate, Token, UserResponse
from ..auth import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login-check")
def login_check(login_data: UserLogin, db: Session = Depends(get_db)):
    """Check if user exists; if yes, prompt for OTP. If no, prompt for registration."""
    user = db.query(User).filter(User.phone == login_data.phone).first()
    if not user:
        return {"registered": False, "message": "Phone number not registered. Please register first."}
    
    # In a real app, send OTP. Here we return success and tell client OTP is 123456
    return {"registered": True, "message": "OTP sent. Use 123456 to verify."}

@router.post("/register")
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user and return OTP prompt."""
    existing_user = db.query(User).filter(User.phone == user_data.phone).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered"
        )
    
    # Default avatars if none specified
    avatar = user_data.avatar
    if not avatar:
        avatar = f"https://api.dicebear.com/7.x/initials/svg?seed={user_data.display_name or 'Signal'}"

    new_user = User(
        phone=user_data.phone,
        display_name=user_data.display_name,
        avatar=avatar,
        is_online=False,
        last_seen=datetime.utcnow()
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"registered": True, "message": "User registered. OTP sent. Use 123456 to verify."}

@router.post("/verify")
def verify_otp(verify_data: UserVerifyOTP, db: Session = Depends(get_db)):
    """Verify OTP (must be '123456') and return JWT token."""
    if verify_data.otp != "123456":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OTP. Use 123456 for testing."
        )
    
    user = db.query(User).filter(User.phone == verify_data.phone).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Generate JWT
    access_token = create_access_token(data={"sub": user.phone})
    
    # Update online status
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(user)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(user)
    }
