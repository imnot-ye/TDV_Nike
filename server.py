
from flask import Flask, request, jsonify
import glob
import os

app = Flask(__name__)

@app.route('/auth', methods=['POST'])
def auth():
    try:
        data = request.get_json()

        if not data or 'username' not in data or 'password' not in data:
            return jsonify({"message": "username and password required", "status": "fail"})

        username = data['username']
        password = data['password']

        search_path = f"users/{username}"
        user_files = glob.glob(search_path)

        if not user_files:
            return jsonify({"message": "bad creads", "status": "unsuccess"})

        with open(user_files[0], 'r') as f:
            real_password = f.read().strip()

        if password == real_password:
            return jsonify({"status": "success"})
        else:
            return jsonify({"message": "bad creads", "status": "unsuccess"})

    except Exception as e:

        error_html = """<!doctype html>
<html lang=en>
<title>500 Internal Server Error</title>
<h1>Internal Server Error</h1>
<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>"""
        return error_html, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)