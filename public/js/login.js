// Update error message based on login attempt
//check login attempts uses fetch from backend rather than unsecure json file
const loginForm = document.getElementById('login_form')
loginForm.addEventListener("submit", async function(e) {
    //prevent default form submission
    e.preventDefault();
    const username = document.querySelector('input[name="username_input"]').value;
    const password = document.querySelector('input[name="password_input"]').value;
    //check fields are empty
    if (!username || !password){
        showLoginError('You must fill out login fields.')
        return;
    }
    try {
        const response = await fetch("/password", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username_input: username, password_input: password })
        });
        const result = await response.json();
        if (!result.success){
            showLoginError(result.error || 'Invalid login information.')
        } else {
            window.location.href = result.redirectTo;
        }
    } catch(err) {
        console.error('Login error', err);
        showLoginError('Server error, please try again.')
    }
})

//function for changing webpage for error message
function showLoginError(message){
    const existing = document.getElementById("login_error");
    if (existing) existing.remove();
    
    const error_msg = document.createElement("p");
    error_msg.id = "login_error";
    error_msg.textContent = message;
    error_msg.classList.add("error");
    document.querySelector("#login_btn").parentNode.insertBefore(error_msg, document.querySelector("#login_btn"));
};

//register button listener
document.getElementById('register-btn').addEventListener('click', () => {
    document.location.href = '/register'
})
