from flask import Flask, render_template, jsonify, send_from_directory
import json
import os

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def get_data():
    with open("dashboard_data.json", "r") as f:
        data = json.load(f)
    return jsonify(data)


@app.route("/api/map")
def get_map():
    # We'll use a local copy or redirect to a CDN if needed.
    # For PythonAnywhere, it's safer to have it local or use a stable CDN.
    # I'll use a CDN link directly in the frontend for simplicity,
    # but this endpoint could serve it too.
    return jsonify({"status": "use_cdn"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8080)
