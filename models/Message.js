const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    room: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 64
    },
    text: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 1000
    },
    sender: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 64
    },
    location: {
        lat: { type: Number },
        lng: { type: Number },
        accuracy: { type: Number }
    },
    time: { type: Date, default: Date.now }
});

messageSchema.index({ room: 1, time: 1 });

module.exports = mongoose.model("Message", messageSchema);
