const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
    eventType: {
        type: String,
        required: true,
        trim: true,
        maxlength: 64
    },
    room: {
        type: String,
        trim: true,
        maxlength: 64
    },
    sender: {
        type: String,
        trim: true,
        maxlength: 64
    },
    socketId: {
        type: String,
        trim: true,
        maxlength: 64
    },
    ip: {
        type: String,
        trim: true,
        maxlength: 128
    },
    userAgent: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    location: {
        lat: { type: Number },
        lng: { type: Number },
        accuracy: { type: Number }
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    },
    time: { type: Date, default: Date.now }
});

activityLogSchema.index({ eventType: 1, time: -1 });
activityLogSchema.index({ room: 1, time: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
