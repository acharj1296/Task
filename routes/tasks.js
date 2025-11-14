const express = require('express');
const Task = require('../models/Task');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Apply auth middleware to all task routes
router.use(requireAuth);

// Dashboard - list all tasks
router.get('/', async (req, res) => {
  try {
    const tasks = await Task.find({ userId: req.user._id }).sort({ createdAt: -1 });

    // Calculate task statistics
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const now = new Date();

    const totalCount = await Task.countDocuments({ userId: req.user._id });
    const activeCount = await Task.countDocuments({
      userId: req.user._id,
      status: 'pending',
      $or: [
        { dueDate: { $eq: null } },
        { dueDate: { $gt: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) } }
      ]
    });
    const completedCount = await Task.countDocuments({ userId: req.user._id, status: 'completed' });
    const overdueCount = await Task.countDocuments({
      userId: req.user._id,
      status: 'pending',
      dueDate: { $lte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) }
    });

    res.render('dashboard', {
      tasks,
      user: req.user,
      totalCount,
      activeCount,
      completedCount,
      overdueCount
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to load tasks' });
  }
});

// New task form
router.get('/new', (req, res) => {
  res.render('task-form', { task: null, isEdit: false });
});

// Create task
router.post('/', async (req, res) => {
  try {
    const { title, description, dueDate, dueTime } = req.body;
    const task = new Task({
      title,
      description,
      dueDate: new Date(dueDate),
      dueTime,
      userId: req.user._id
    });
    await task.save();
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to create task' });
  }
});

// Edit task form
router.get('/:id/edit', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).render('error', { message: 'Task not found' });
    }
    res.render('task-form', { task, isEdit: true });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to load task' });
  }
});

// Update task
router.post('/:id', async (req, res) => {
  try {
    const { title, description, dueDate, dueTime } = req.body;
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { title, description, dueDate: new Date(dueDate), dueTime },
      { new: true }
    );
    if (!task) {
      return res.status(404).render('error', { message: 'Task not found' });
    }
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to update task' });
  }
});

// Toggle task status
router.post('/:id/toggle', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).render('error', { message: 'Task not found' });
    }
    task.status = task.status === 'pending' ? 'completed' : 'pending';
    await task.save();
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to update task status' });
  }
});

// Delete task
router.post('/:id/delete', async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).render('error', { message: 'Task not found' });
    }
    res.redirect('/tasks');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Failed to delete task' });
  }
});

module.exports = router;
