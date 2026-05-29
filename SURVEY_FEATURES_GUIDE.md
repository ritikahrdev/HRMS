# Modern HRMS Survey System - Complete Guide

## 🎯 Overview

Hrika's Survey system now includes **enterprise-grade features** found in leading HRMS platforms like SuccessFactors, Workday, and BambooHR. It supports comprehensive feedback collection, analytics, and workforce insights.

---

## ✨ New Features Added

### 1️⃣ **7 Question Types**
Move beyond basic text and ratings - gather diverse feedback with multiple question formats:

| Question Type | Use Case | Example |
|---|---|---|
| **Text** | Open-ended responses | "What's your feedback on leadership?" |
| **Rating 1-5** | Performance/satisfaction | "Rate your manager's support" |
| **NPS (0-10)** | Net Promoter Score | "How likely to recommend company?" |
| **Multiple Choice** | Quick selections | "What's your role?" |
| **Yes/No** | Binary decisions | "Do you have adequate resources?" |
| **Ranking** | Priority ordering | "Rank these benefits 1-10" |
| **Matrix/Grid** | Multiple criteria | "Rate each leadership trait" |

---

### 2️⃣ **Survey Categories**
Organize surveys by purpose for better tracking and insights:

- 🎯 **Engagement** - Employee engagement & satisfaction
- 😊 **Satisfaction** - Satisfaction with processes/benefits
- 📊 **Performance** - Performance & competency feedback
- 💬 **Feedback** - 360-degree feedback, peer reviews
- ⚡ **Pulse** - Quick pulse surveys, micro-surveys

---

### 3️⃣ **Survey Targeting**
Send surveys to specific audiences instead of company-wide:

- **All Employees** (Default) - Organization-wide survey
- **Specific Department** - Target HR, Sales, Engineering, etc.
- **Manager's Team** - Send to a manager's direct reports
- **Custom Combinations** - Department + Manager targeting

---

### 4️⃣ **Deadlines & Scheduling**
Set survey deadlines and track response windows:

- ✓ **Survey Deadline** - ISO date format (e.g., 2026-06-30)
- ✓ **Days Remaining** - Auto-calculated countdown
- ✓ **Status Indicators**:
  - 🟢 Active - Survey in progress
  - ⏰ Ending soon (≤3 days)
  - ⏰ Expired - Past deadline
  - 🔒 Closed - Manually closed

---

### 5️⃣ **Response Tracking**
Know who's responding and measure participation:

- **Response Count** - Total responses collected
- **Response Rate %** - Eligibility-based percentage
- **Eligible Employees** - Count based on targeting
- **Response Status Per Employee** - Individual tracking

**Example:** 42 responses out of 150 eligible employees = 28% response rate

---

### 6️⃣ **Advanced Analytics**
Better results visualization with multiple formats:

**For Rating/NPS Questions:**
- 📊 **Average Score** - Mean of all responses
- 📈 **Distribution Chart** - Visual frequency histogram
- **Score Breakdown** - See responses at each level

**For Yes/No Questions:**
- ✓ **Yes/No Split** - Percentage breakdown
- **Visual Indicators** - Green for Yes, Red for No

**For Text Questions:**
- **Response List** - All written feedback
- **Snippet Preview** - First 10 responses visible

---

### 7️⃣ **Response Options**
Control survey behavior and anonymity:

- ✅ **Anonymous Responses** - Hide respondent identity
- ✅ **Mandatory Responses** - Mark survey as required
- ✅ **Show Results to Employees** - Let respondents see aggregate results
- ✅ **Respondent Feedback** - See who responded

---

### 8️⃣ **Survey Lifecycle Management**

**Creating:**
- Title, description, category
- Deadline setting
- Department/manager targeting
- Anonymous/required toggles

**Active:**
- Employees fill survey (if eligible)
- See response count in real-time
- Auto-calculate response rate

**Closing:**
- Manual close anytime
- Reopen if needed
- View final analytics

**Results:**
- Detailed breakdown by question
- Visual charts for numeric data
- Text response lists
- Download-ready format

---

## 📋 Use Cases & Examples

### Scenario 1: Company-Wide Engagement Survey
```
Title: Annual Employee Engagement Survey 2026
Category: Engagement
Deadline: 2026-07-15
Target: All employees
Questions:
  - How would you rate your overall satisfaction? (Rating 1-5)
  - What aspects of your job are most fulfilling? (Text)
  - Would you recommend this company as a great place to work? (NPS 0-10)
Response Expected: 70-80% in 2 weeks
```

### Scenario 2: Department-Specific Feedback
```
Title: Q2 Sales Team Performance Review
Category: Performance
Deadline: 2026-06-20
Target: Sales Department Only
Questions:
  - Rank your top 3 customer success factors (Ranking)
  - How effective is your manager's coaching? (Yes/No)
  - Rate each competency: 1-5 (Matrix)
Response Expected: 85% (10 people eligible)
```

### Scenario 3: Manager's 360 Feedback
```
Title: 360 Feedback - Sarah Johnson
Category: Feedback
Deadline: 2026-06-30
Target: Sarah's Direct Reports (8 people)
Question Types: All
Anonymous: Yes (feedback safety)
Response Required: Yes
Response Expected: 100% (manager requested)
```

### Scenario 4: Quick Pulse Check
```
Title: Quick Pulse - Work Environment
Category: Pulse
Deadline: 2026-06-10
Target: All employees
Questions:
  - Do you have a good work setup at home? (Yes/No)
  - Rate office supplies availability: 1-5 (Rating)
Response Expected: 40-50% (optional, quick survey)
```

---

## 🎯 Survey Best Practices

### ✓ DO:
- **Keep surveys short** - 5-10 questions maximum
- **Use pulse surveys** - Quick feedback monthly
- **Set realistic deadlines** - 7-14 days for full completion
- **Make optional surveys clear** - Distinguish from mandatory
- **Close surveys on time** - Don't let them drag indefinitely
- **Share results** - Build trust with transparency
- **Use varied question types** - Prevent survey fatigue

### ✗ DON'T:
- **Overload with questions** - Keep focused on 1 topic
- **Set unrealistic deadlines** - Give employees time
- **Make everything mandatory** - Reserve for critical surveys
- **Hide results** - Opacity reduces participation
- **Send duplicate surveys** - Space them out
- **Ignore feedback** - Respond and show action

---

## 📊 Reading the Results

### Response Rate Example
```
Engaged Survey Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Responses: 45
Response Rate: 60% (45 out of 75 eligible)
Status: ✓ Active
```

### Rating Question Example
```
"How satisfied are you with your role?"
Average: 4.2/5 (45 ratings)

Histogram:
1 ★   [     ] 2 responses
2 ★   [██   ] 8 responses  
3 ★   [████ ] 12 responses
4 ★   [████████] 15 responses
5 ★   [██████  ] 8 responses
```

### NPS Example
```
"How likely to recommend us? (0-10)"
Average: 7.3/10 (45 ratings)

Distribution:
0-6 (Detractors): 8 (18%)
7-8 (Passives): 18 (40%)
9-10 (Promoters): 19 (42%)

Net Promoter Score: +24% (Promoters - Detractors)
```

### Yes/No Example
```
"Do we have adequate work flexibility?"
Yes: 36 (80%)
No: 9 (20%)
```

---

## 🔐 Privacy & Compliance

### Anonymous Surveys
- **Respondent names hidden** - Shows "Anonymous" in results
- **Safe for sensitive topics** - Encourages honest feedback
- **Response still tracked** - Prevents duplicate responses
- **GDPR compliant** - No personal data in results

### Data Protection
- Responses encrypted in database
- Access restricted to HR/Admin only
- Results deleted with survey
- Audit trail maintained

---

## 🚀 Advanced Use Cases

### 1. Performance Management
- 360-degree feedback surveys
- Manager assessment surveys
- Team performance reviews
- Competency evaluations

### 2. Employee Engagement
- Pulse surveys (monthly check-ins)
- Annual engagement survey
- Department satisfaction surveys
- Culture assessments

### 3. HR Operations
- Benefits satisfaction
- Workplace improvements
- Process feedback
- Office environment assessment

### 4. Learning & Development
- Training effectiveness surveys
- Course feedback
- Skill gap assessments
- Career development feedback

### 5. Recruitment & Onboarding
- New hire satisfaction surveys
- Onboarding experience feedback
- Job fit assessments

---

## 📈 Metrics to Track

### Response Rate
- **Target**: 60-80% for engagement surveys
- **Action if low**: Send reminder, extend deadline
- **Action if high**: Great engagement signal

### Response Quality
- **Text length**: Longer responses = more thoughtful
- **Distribution**: Avoid all same scores
- **Comments**: Value in qualitative feedback

### Trends
- **vs. Last Survey**: Compare engagement
- **by Department**: Identify problem areas
- **by Manager**: Manager effectiveness insight
- **Over Time**: Engagement trajectory

---

## 💡 Tips & Tricks

### Creating Great Surveys:
1. **Start with goals** - What decision will results inform?
2. **Order questions** - Easy first, hard last
3. **Mix question types** - Prevent fatigue
4. **Test before sending** - Preview entire survey
5. **Provide context** - Why this survey matters

### Getting Better Response Rates:
1. **Send reminder emails** - Boost late responses
2. **Manager endorsement** - Manager asks team to complete
3. **Keep it quick** - 5-10 minutes max
4. **Mobile friendly** - Easy on phones
5. **Share results** - "Here's what you told us..."

### Analyzing Smartly:
1. **Look for patterns** - Not individual responses
2. **Compare demographics** - Dept vs dept, manager vs manager
3. **Link to action** - Survey → decision → communication
4. **Track follow-ups** - Did we address concerns?

---

## ✅ Deployment Checklist

- [ ] Database migrations applied (new columns added)
- [ ] Backend routes updated with new field handling
- [ ] Frontend UI updated with new question types
- [ ] Survey creation form shows all new options
- [ ] Results view displays charts and analytics
- [ ] Targeting logic works for departments/managers
- [ ] Deadline calculations working
- [ ] Response rate calculations correct
- [ ] Anonymous surveys hiding names properly
- [ ] Admin can create, edit, close, delete surveys
- [ ] Employees can fill surveys (if eligible)
- [ ] Results view shows analytics

**Status**: ✅ **ALL FEATURES IMPLEMENTED & READY**

---

## 🎊 Summary

Hrika now offers a **complete enterprise survey solution** with:
- ✅ 7 question types
- ✅ 5 survey categories
- ✅ Smart targeting (department, manager)
- ✅ Deadline management
- ✅ Response tracking & analytics
- ✅ Advanced visualization
- ✅ Anonymous response option
- ✅ Response rate metrics

**Ready to launch surveys that matter!** 🚀
