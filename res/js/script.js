document.getElementById("loginform").addEventListener('submit', function(event) {
    event.preventDefault();

    // Init variable for user data
    const correctUsername = "iydheko";
    const correctPassword = "123";

    // Get inputed data from input form
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    // check if user data correct or not
    if(username == correctUsername && password == correctPassword){
        alert("Login Berhasil");
        window.location.href = "index.html";
    } else {
        alert("Username atau Password salah");
    }
})