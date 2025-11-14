const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Configure Multer for profile picture uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/uploads/profilePics'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// Home page - redirect to login if not authenticated
router.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/tasks');
  }
  res.redirect('/login');
});

// Register page
router.get('/register', (req, res) => {
  res.render('register', { error: null, formData: null });
});

// Register POST
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, confirmPassword } = req.body;

    // Check if passwords match
    if (password !== confirmPassword) {
      return res.render('register', { error: 'Password and Confirm Password do not match.', formData: { firstName, lastName, username, email, password, confirmPassword } });
    }

    // Create user
    const user = new User({ username: username.trim(), firstName: firstName.trim(), lastName: lastName.trim(), email, password });
    await user.save();

    // Generate OTP
    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Send OTP email
    const userName = user.firstName || 'User';
    const expirationTime = '10 minutes';
    const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Account</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 20px;">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #dddddd; border-radius: 8px;">
                    <!-- Branding Header -->
                    <tr>
                        <td align="center" style="padding: 20px; background-color: #007bff; color: #ffffff; border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; font-size: 24px;">Task Manager</h1>
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="color: #333333; margin-bottom: 20px;">Verify Your Account</h2>
                            <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Hello ${userName},</p>
                            <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Thank you for registering with Task Manager. To complete your account verification, please use the One-Time Password (OTP) below:</p>
                            <!-- OTP Box -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f0f0; border: 1px solid #cccccc; border-radius: 4px; margin: 20px 0;">
                                <tr>
                                    <td align="center" style="padding: 20px;">
                                        <span style="font-size: 28px; font-weight: bold; color: #007bff;">${otp}</span>
                                    </td>
                                </tr>
                            </table>
                            <p style="color: #999999; font-size: 14px; margin-bottom: 20px;">This code expires in ${expirationTime}.</p>
                            <p style="color: #666666; font-size: 16px;">If you did not request this verification, please ignore this email. Your account will remain secure.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td align="center" style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; color: #666666; font-size: 12px;">
                            <p style="margin: 0;">© 2023 Task Manager. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your Account - Your One-Time Password',
      html: htmlTemplate
    });

    req.session.tempUserId = user._id;
    res.redirect('/verify-email');
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      // Duplicate key error
      return res.render('register', { error: 'This Username or Email is already registered.', formData: { firstName, lastName, username, email, password, confirmPassword } });
    }
    res.render('register', { error: 'Registration failed. Please try again.', formData: { firstName, lastName, username, email, password, confirmPassword } });
  }
});

// Login page
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login POST
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Basic email regex to determine if identifier is an email or username
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    const isEmail = emailRegex.test(identifier);

    // Query user based on identifier type
    const query = isEmail ? { email: identifier } : { username: identifier };
    const user = await User.findOne(query);

    if (!user || !(await user.comparePassword(password))) {
      return res.render('login', { error: 'Invalid Username/Email or Password' });
    }

    if (!user.isVerified) {
      req.session.tempUserId = user._id;
      return res.redirect('/verify-email');
    }

    req.session.userId = user._id;
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.render('login', { error: 'Login failed. Please try again.' });
  }
});

// Verify email page
router.get('/verify-email', (req, res) => {
  if (!req.session.tempUserId) {
    return res.redirect('/login');
  }
  res.render('verify-email', { error: null });
});

// Verify email POST
router.post('/verify-email', async (req, res) => {
  try {
    const { otp } = req.body;
    const userId = req.session.tempUserId;

    if (!userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(userId);
    if (!user || user.otp !== otp || user.otpExpiry < new Date()) {
      return res.render('verify-email', { error: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    req.session.userId = user._id;
    req.session.tempUserId = undefined;
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.render('verify-email', { error: 'Verification failed. Please try again.' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { error: null, success: null });
});

// Forgot password POST
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, error: 'No account with that email address exists.' });
    }

    // Generate secure token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
    const userName = user.firstName || 'User';
    const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Request</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 20px;">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #dddddd; border-radius: 8px;">
                    <!-- Branding Header -->
                    <tr>
                        <td align="center" style="padding: 20px; background-color: #007bff; color: #ffffff; border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; font-size: 24px;">Task Manager</h1>
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="color: #333333; margin-bottom: 20px;">Password Reset Request</h2>
                            <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Hello ${userName},</p>
                            <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">We received a request to reset the password for your account.</p>
                            <!-- Reset Button -->
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <a href="${resetUrl}" style="display: inline-block; padding: 12px 25px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Reset Your Password</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="color: #999999; font-size: 14px; margin-bottom: 20px;">This link is valid for 1 hour.</p>
                            <p style="color: #666666; font-size: 16px;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td align="center" style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; color: #666666; font-size: 12px;">
                            <p style="margin: 0;">© 2023 Task Manager. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request for Your Account',
      html: htmlTemplate
    });

    res.json({ success: true, email: email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
  }
});

// Reset password page
router.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.render('error', { message: 'Password reset token is invalid or has expired.' });
    }

    res.render('reset-password', { token: req.params.token, error: null });
  } catch (error) {
    console.error(error);
    res.render('error', { message: 'An error occurred.' });
  }
});

// Reset password POST
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.render('reset-password', { token: req.params.token, error: 'Passwords do not match.' });
    }

    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.render('error', { message: 'Password reset token is invalid or has expired.' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.redirect('/login');
  } catch (error) {
    console.error(error);
    res.render('reset-password', { token: req.params.token, error: 'An error occurred. Please try again.' });
  }
});

// Profile page
router.get('/profile', requireAuth, (req, res) => {
  res.render('profile', { user: req.user, message: null });
});

// Update password
router.post('/profile/update-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Check if new passwords match
    if (newPassword !== confirmPassword) {
      return res.render('profile', { user: req.user, message: { type: 'error', text: 'New passwords do not match.' } });
    }

    // Verify current password
    const isCurrentPasswordValid = await req.user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.render('profile', { user: req.user, message: { type: 'error', text: 'Current password is incorrect.' } });
    }

    // Update password
    req.user.password = newPassword;
    await req.user.save();

    res.render('profile', { user: req.user, message: { type: 'success', text: 'Password updated successfully!' } });
  } catch (error) {
    console.error(error);
    res.render('profile', { user: req.user, message: { type: 'error', text: 'An error occurred. Please try again.' } });
  }
});

// Upload profile picture
router.post('/profile/upload-photo', requireAuth, upload.single('profilePic'), async (req, res) => {
  try {
    if (!req.file) {
      return res.render('profile', { user: req.user, message: { type: 'error', text: 'No file uploaded.' } });
    }

    // Get the old profile picture path before updating
    const oldPath = req.user.profilePicturePath;

    // Update user's profile picture path
    req.user.profilePicturePath = '/uploads/profilePics/' + req.file.filename;
    await req.user.save();

    // Delete the old profile picture file if it exists and is not a default avatar
    if (oldPath && oldPath !== '/images/default-avatar.png') {
      const fullOldPath = path.join(__dirname, '../public', oldPath);
      fs.unlink(fullOldPath, (err) => {
        if (err) {
          console.error('Failed to delete old profile picture:', err);
          // Continue execution, as file deletion is secondary to the update
        } else {
          console.log(`Old profile picture deleted successfully: ${oldPath}`);
        }
      });
    }

    res.render('profile', { user: req.user, message: { type: 'success', text: 'Profile picture uploaded successfully!' } });
  } catch (error) {
    console.error(error);
    res.render('profile', { user: req.user, message: { type: 'error', text: 'An error occurred while uploading the picture. Please try again.' } });
  }
});

// Update user info
router.post('/profile/update-info', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, username } = req.body;

    // Check if username is already taken by another user
    const existingUser = await User.findOne({ username: username.trim(), _id: { $ne: req.user._id } });
    if (existingUser) {
      return res.render('profile', { user: req.user, message: { type: 'error', text: 'Username is already taken.' } });
    }

    // Update user fields
    req.user.firstName = firstName.trim();
    req.user.lastName = lastName.trim();
    req.user.username = username.trim();
    await req.user.save();

    res.render('profile', { user: req.user, message: { type: 'success', text: 'Profile updated successfully!' } });
  } catch (error) {
    console.error(error);
    res.render('profile', { user: req.user, message: { type: 'error', text: 'An error occurred. Please try again.' } });
  }
});

// API routes for availability checks
router.get('/api/check-username/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    res.json({ available: !user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ available: false });
  }
});

router.get('/api/check-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email });
    res.json({ available: !user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ available: false });
  }
});

module.exports = router;
