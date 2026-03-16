from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import gspread
import pandas as pd
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()
app = FastAPI()

# CRITICAL: Allow React (port 3000) to talk to Python (port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_sheet_data():
    key_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_file(key_path, scopes=scopes)
    client = gspread.authorize(creds)
    
    sheet = client.open_by_key(os.environ.get('GOOGLE_SHEET_ID')).sheet1
    all_values = sheet.get_all_values()
    
    # Use Pandas to handle the headers/data
    df = pd.DataFrame(all_values[1:], columns=all_values[0])
    return df.to_dict(orient='records')

@app.get("/api/supplies")
async def supplies():
    data = get_sheet_data()
    return data

# Run with: uvicorn main:app --reload