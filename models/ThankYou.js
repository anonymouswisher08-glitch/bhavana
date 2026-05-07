const mongoose = require("mongoose");

const thankYouSchema = new mongoose.Schema({
    room: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 64
    },
    sender: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 64
    },
    time: { type: Date, default: Date.now }
});

thankYouSchema.index({ room: 1, time: -1 });

module.exports = mongoose.model("ThankYou", thankYouSchema);
